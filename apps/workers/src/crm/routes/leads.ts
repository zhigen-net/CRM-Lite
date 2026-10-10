import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { v4 as uuidv4 } from 'uuid'
import { requireAuth, requireAdmin } from '../middleware/auth'
import { toCamel, toCamelList } from '../../shared/db'
import { executeWorkflowsForTrigger } from '../workflow/executor'

export const leadsRoutes = new Hono<{ Bindings: Env }>()

leadsRoutes.use('*', requireAuth)

const BASE_JOIN = 'FROM leads l LEFT JOIN users u ON l.created_by_userId = u.id LEFT JOIN users assign_u ON l.assigned_to_userId = assign_u.id'
const SELECT_COLS = 'SELECT l.*, u.name as created_by_name, assign_u.name as assigned_to_name, (SELECT COUNT(*) FROM sales_activities WHERE lead_id = l.id) as activity_count'

function parseLead(row: Record<string, unknown>) {
  const lead = toCamel(row) as Record<string, unknown>
  if (typeof lead.intendedServices === 'string') {
    try { lead.intendedServices = JSON.parse(lead.intendedServices as string) } catch { lead.intendedServices = [] }
  }
  if (typeof lead.adInfo === 'string') {
    try { lead.adInfo = JSON.parse(lead.adInfo as string) } catch { lead.adInfo = null }
  }
  return lead
}

// GET /api/leads/sources — 返回去重的来源列表（用于前端自动补全）
leadsRoutes.get('/sources', async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT DISTINCT source FROM leads WHERE source IS NOT NULL AND source != '' AND deleted_at IS NULL ORDER BY source ASC",
  ).all<{ source: string }>()
  return c.json({ data: rows.results.map((r) => r.source) })
})

// GET /api/leads/new-count — 导航栏"新线索"角标专用的轻量计数
// 前端会定时轮询，因此只做一次走 status 索引的 COUNT，不做 JOIN / 排序 / 子查询；
// 可见范围与 GET /api/leads 一致（销售只统计分配给自己或本团队未分配的线索）
leadsRoutes.get('/new-count', async (c) => {
  const { userId, role, teamId } = c.get('jwtPayload')
  let sql = "SELECT COUNT(*) AS total FROM leads l WHERE l.deleted_at IS NULL AND l.status = 'New'"
  const params: unknown[] = []
  if (role === 'sales') {
    sql += ' AND (l.assigned_to_userId = ? OR (l.assigned_to_userId IS NULL AND l.assigned_to_teamId = ?))'
    params.push(userId, teamId)
  }
  const row = await c.env.DB.prepare(sql).bind(...params).first<{ total: number }>()
  return c.json({ total: row?.total ?? 0 })
})

// GET /api/leads
leadsRoutes.get('/', async (c) => {
  const { userId, role, teamId } = c.get('jwtPayload')
  const { status, mine, search, source, assignedTo, nextContact, createdAt, activityCount, service, page = '1', pageSize = '20' } = c.req.query()
  const offset = (Number(page) - 1) * Number(pageSize)

  let whereClause = 'WHERE l.deleted_at IS NULL'
  const whereParams: unknown[] = []

  if (role === 'sales') {
    whereClause += ' AND (l.assigned_to_userId = ? OR (l.assigned_to_userId IS NULL AND l.assigned_to_teamId = ?))'
    whereParams.push(userId, teamId)
  } else if (mine === 'true') {
    whereClause += ' AND l.assigned_to_userId = ?'
    whereParams.push(userId)
  }
  if (status) {
    whereClause += ' AND l.status = ?'
    whereParams.push(status)
  }
  if (source) {
    whereClause += ' AND l.source = ?'
    whereParams.push(source)
  }
  if (assignedTo) {
    whereClause += ' AND l.assigned_to_userId = ?'
    whereParams.push(assignedTo)
  }
  if (nextContact === 'overdue') {
    whereClause += " AND l.next_contact_date IS NOT NULL AND l.next_contact_date < date('now')"
  } else if (nextContact === 'today') {
    whereClause += " AND l.next_contact_date = date('now')"
  } else if (nextContact === 'week') {
    whereClause += " AND l.next_contact_date IS NOT NULL AND l.next_contact_date BETWEEN date('now') AND date('now', '+7 days')"
  }
  if (createdAt === 'today') {
    whereClause += " AND DATE(l.created_at) = DATE('now')"
  } else if (createdAt === 'week') {
    whereClause += " AND DATE(l.created_at) >= DATE('now', '-7 days')"
  } else if (createdAt === 'month') {
    whereClause += " AND DATE(l.created_at) >= DATE('now', '-30 days')"
  }
  if (activityCount === '0') {
    whereClause += ' AND (SELECT COUNT(*) FROM sales_activities WHERE lead_id = l.id) = 0'
  } else if (activityCount === '1-3') {
    whereClause += ' AND (SELECT COUNT(*) FROM sales_activities WHERE lead_id = l.id) BETWEEN 1 AND 3'
  } else if (activityCount === '3+') {
    whereClause += ' AND (SELECT COUNT(*) FROM sales_activities WHERE lead_id = l.id) > 3'
  }
  if (service) {
    whereClause += ' AND l.intended_services LIKE ?'
    whereParams.push(`%${service}%`)
  }
  if (search) {
    whereClause += ' AND (l.name LIKE ? OR l.contact_info LIKE ? OR l.source LIKE ? OR CAST(l.lead_no AS TEXT) LIKE ?)'
    const q = `%${search}%`
    whereParams.push(q, q, q, q)
  }

  const results = await c.env.DB.prepare(
    `${SELECT_COLS} ${BASE_JOIN} ${whereClause} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`,
  ).bind(...whereParams, Number(pageSize), offset).all()

  const countResult = await c.env.DB.prepare(
    `SELECT COUNT(*) as total ${BASE_JOIN} ${whereClause}`,
  ).bind(...whereParams).first<{ total: number }>()

  return c.json({
    data: (results.results as Record<string, unknown>[]).map(parseLead),
    total: countResult?.total ?? 0,
    page: Number(page),
    pageSize: Number(pageSize),
  })
})

// GET /api/leads/:id
leadsRoutes.get('/:id', async (c) => {
  const { role, userId, teamId } = c.get('jwtPayload')
  const lead = await c.env.DB.prepare(
    `${SELECT_COLS} ${BASE_JOIN} WHERE l.id = ? AND l.deleted_at IS NULL`,
  ).bind(c.req.param('id')).first() as Record<string, unknown> | null
  if (!lead) throw new HTTPException(404, { message: '线索不存在' })
  if (role === 'sales') {
    const ownedByUser = lead.assigned_to_userId === userId
    const ownedByTeam = !lead.assigned_to_userId && lead.assigned_to_teamId === teamId
    if (!ownedByUser && !ownedByTeam) {
      throw new HTTPException(403, { message: '无权访问此线索' })
    }
  }
  return c.json({ data: parseLead(lead) })
})

const leadSchema = z.object({
  source: z.string().min(1),
  name: z.string().min(1),
  contactInfo: z.string().min(1),
  intendedServices: z.array(z.string()).min(1, '请至少选择一个意向服务'),
  notes: z.string().nullable().optional(),
})

// POST /api/leads
leadsRoutes.post('/', zValidator('json', leadSchema), async (c) => {
  const body = c.req.valid('json')
  const { userId } = c.get('jwtPayload')
  const id = uuidv4()

  // 取创建人所属团队，创建时预关联
  const creator = await c.env.DB.prepare('SELECT team_id FROM users WHERE id = ?').bind(userId).first<{ team_id: string | null }>()
  const teamId = creator?.team_id ?? null

  await c.env.DB.prepare(
    `INSERT INTO leads (id, source, name, contact_info, intended_services, status, notes, created_by_userId, assigned_to_teamId, lead_no)
     VALUES (?, ?, ?, ?, ?, 'New', ?, ?, ?, (SELECT COALESCE(MAX(lead_no), 0) + 1 FROM leads))`,
  ).bind(
    id,
    body.source,
    body.name,
    body.contactInfo,
    JSON.stringify(body.intendedServices),
    body.notes ?? null,
    userId,
    teamId,
  ).run()

  // 推送到线索分配队列
  await c.env.LEAD_ASSIGNMENT_QUEUE.send({ leadId: id })

  // 触发 on_create 工作流（fire-and-forget）
  c.executionCtx.waitUntil(
    executeWorkflowsForTrigger(c.env.DB, c.env, 'lead', id, { type: 'on_create' })
      .catch((err) => console.error('[workflow] on_create lead error:', err)),
  )

  const lead = await c.env.DB.prepare(
    `${SELECT_COLS} ${BASE_JOIN} WHERE l.id = ?`,
  ).bind(id).first()
  return c.json({ data: parseLead(lead as Record<string, unknown>) }, 201)
})

// PUT /api/leads/:id
leadsRoutes.put(
  '/:id',
  zValidator(
    'json',
    z.object({
      status: z.enum(['New', 'Contacted', 'Qualified', 'Converted', 'Lost']).optional(),
      notes: z.string().nullable().optional(),
      assignedToUserId: z.string().nullable().optional(),
      assignedToTeamId: z.string().nullable().optional(),
      contactInfo: z.string().optional(),
      intendedServices: z.array(z.string()).min(1).optional(),
      adInfo: z.record(z.string()).nullable().optional(),
    }),
  ),
  async (c) => {
    const id = c.req.param('id')
    const body = c.req.valid('json')
    const { role, userId } = c.get('jwtPayload')

    const lead = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<{
      assigned_to_userId: string | null; status: string; notes: string | null
      contact_info: string; assigned_to_teamId: string | null; intended_services: string
      source: string | null; lost_reason: string | null; next_contact_date: string | null
    }>()
    if (!lead) throw new HTTPException(404, { message: '线索不存在' })

    if (lead.status === 'Converted') {
      throw new HTTPException(403, { message: '线索已转化，不可修改' })
    }

    if (role === 'sales' && lead.assigned_to_userId !== userId) {
      throw new HTTPException(403, { message: '无权操作此线索' })
    }

    const updates: string[] = ['updated_at = CURRENT_TIMESTAMP']
    const params: unknown[] = []

    if (body.status !== undefined) { updates.push('status = ?'); params.push(body.status) }
    if (body.notes !== undefined) { updates.push('notes = ?'); params.push(body.notes) }
    if (body.assignedToUserId !== undefined) {
      if (body.assignedToUserId !== null) {
        // 校验被指派人是否属于该线索的团队
        const targetUser = await c.env.DB.prepare('SELECT team_id FROM users WHERE id = ? AND is_active = 1').bind(body.assignedToUserId).first<{ team_id: string | null }>()
        if (!targetUser) throw new HTTPException(400, { message: '指派目标用户不存在或已停用' })

        const isChangingTeam = body.assignedToTeamId !== undefined
        if (!isChangingTeam && lead.assigned_to_teamId && targetUser.team_id !== lead.assigned_to_teamId) {
          throw new HTTPException(400, { message: '只能指派给本团队的销售，如需跨团队请同时指定新团队（assignedToTeamId）' })
        }
      }
      updates.push('assigned_to_userId = ?')
      params.push(body.assignedToUserId)
    }
    if (body.assignedToTeamId !== undefined) {
      if (body.assignedToTeamId !== null && role !== 'admin') {
        throw new HTTPException(403, { message: '只有管理员可以变更线索所属团队' })
      }
      updates.push('assigned_to_teamId = ?')
      params.push(body.assignedToTeamId)
    }
    if (body.contactInfo !== undefined) { updates.push('contact_info = ?'); params.push(body.contactInfo) }
    if (body.intendedServices !== undefined) {
      updates.push('intended_services = ?')
      params.push(JSON.stringify(body.intendedServices))
    }
    if (body.adInfo !== undefined) {
      updates.push('ad_info = ?')
      params.push(body.adInfo === null ? null : JSON.stringify(body.adInfo))
    }

    params.push(id)
    await c.env.DB.prepare(`UPDATE leads SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...params)
      .run()

    // ── current_leads_count 维护 ──
    const TERMINAL = ['Converted', 'Lost']
    const wasActive = !TERMINAL.includes(lead.status)
    const newStatus = body.status ?? lead.status
    const becomingTerminal = wasActive && TERMINAL.includes(newStatus)
    const reassigning = body.assignedToUserId !== undefined && body.assignedToUserId !== lead.assigned_to_userId

    if (becomingTerminal) {
      // 线索关闭 → 减少原负责人计数
      if (lead.assigned_to_userId) {
        await c.env.DB.prepare(
          'UPDATE users SET current_leads_count = MAX(0, current_leads_count - 1) WHERE id = ?',
        ).bind(lead.assigned_to_userId).run()
      }
    } else if (reassigning && wasActive) {
      // 重新分配（仅限活跃线索）→ 旧人 -1，新人 +1
      if (lead.assigned_to_userId) {
        await c.env.DB.prepare(
          'UPDATE users SET current_leads_count = MAX(0, current_leads_count - 1) WHERE id = ?',
        ).bind(lead.assigned_to_userId).run()
      }
      if (body.assignedToUserId) {
        await c.env.DB.prepare(
          'UPDATE users SET current_leads_count = current_leads_count + 1 WHERE id = ?',
        ).bind(body.assignedToUserId).run()
      }
    }

    // 记录修改操作
    const statusLabels: Record<string, string> = {
      New: '新线索', Contacted: '已联系', Qualified: '已确认', Converted: '已转化', Lost: '已丢失',
    }
    const changes: string[] = []
    const oldServices = (() => { try { return JSON.parse(lead.intended_services) } catch { return [] } })() as string[]
    if (body.status !== undefined && body.status !== lead.status) changes.push(`状态→${statusLabels[body.status] ?? body.status}`)
    if (body.notes !== undefined && body.notes !== lead.notes) changes.push('备注已更新')
    if (body.contactInfo !== undefined && body.contactInfo !== lead.contact_info) changes.push('联系方式已更新')
    if (body.intendedServices !== undefined && JSON.stringify(body.intendedServices) !== JSON.stringify(oldServices)) {
      changes.push(`意向服务：${oldServices.join('、')} → ${body.intendedServices.join('、')}`)
    }
    if (body.assignedToUserId !== undefined && body.assignedToUserId !== lead.assigned_to_userId) changes.push('负责人已变更')
    if (changes.length > 0) {
      await c.env.DB.prepare(
        `INSERT INTO sales_activities (id, lead_id, user_id, activity_type, description, activity_date)
         VALUES (?, ?, ?, 'System', ?, CURRENT_TIMESTAMP)`,
      ).bind(uuidv4(), id, userId, changes.join('；')).run()
    }

    // 触发 field_change 工作流（所有变更字段）
    const fieldChangeTriggers: Array<{ field: string; oldVal: unknown; newVal: unknown }> = [
      { field: 'status',           oldVal: lead.status,             newVal: body.status },
      { field: 'assignedToUserId', oldVal: lead.assigned_to_userId, newVal: body.assignedToUserId },
    ]
    for (const { field, oldVal, newVal } of fieldChangeTriggers) {
      if (newVal !== undefined && newVal !== null && newVal !== oldVal) {
        c.executionCtx.waitUntil(
          executeWorkflowsForTrigger(c.env.DB, c.env, 'lead', id, { type: 'field_change', field, to: String(newVal) })
            .catch((err) => console.error(`[workflow] field_change lead ${field} error:`, err)),
        )
      }
    }

    const updated = await c.env.DB.prepare(
      `${SELECT_COLS} ${BASE_JOIN} WHERE l.id = ?`,
    ).bind(id).first()
    return c.json({ data: parseLead(updated as Record<string, unknown>) })
  },
)

// POST /api/leads/:id/status-transition
// 带字段策略校验的状态变更：同时写跟进记录 + 更新状态/策略字段
leadsRoutes.post('/:id/status-transition', async (c) => {
  const id = c.req.param('id')
  const { role, userId } = c.get('jwtPayload')
  const body = await c.req.json<{
    targetStatus: string
    activity: {
      activityType: string
      description?: string
      activityDate: string
      attachmentKeys?: { key: string; name: string; size?: number; mimeType?: string }[]
    }
    fields?: Record<string, unknown>
  }>()

  const lead = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<{
    assigned_to_userId: string | null; status: string; intended_services: string
  }>()
  if (!lead) throw new HTTPException(404, { message: '线索不存在' })
  if (lead.status === 'Converted') throw new HTTPException(403, { message: '线索已转化，不可修改' })
  if (role === 'sales' && lead.assigned_to_userId !== userId) {
    throw new HTTPException(403, { message: '无权操作此线索' })
  }

  // field_policies 表已在 migration 0016 迁移至 workflows，此处不再查询
  // 必填字段校验改为前端 workflow require_fields 动作承担

  // 把 fields 键值拼入跟进描述，让跟进列表信息完整
  const fieldLines: string[] = []
  for (const [key, val] of Object.entries(body.fields ?? {})) {
    if (val === undefined || val === null || val === '') continue
    const label = { lostReason: '丢失原因', nextContactDate: '下次联系', intendedServices: '意向服务' }[key] ?? key
    fieldLines.push(`${label}：${Array.isArray(val) ? (val as string[]).join('、') : val}`)
  }
  const userDesc = body.activity?.description?.trim() ?? ''
  const finalDescription = [userDesc, ...fieldLines].filter(Boolean).join('\n') || null

  // 更新线索状态 + 策略字段
  const updates = ['status = ?', 'updated_at = CURRENT_TIMESTAMP']
  const params: unknown[] = [body.targetStatus]

  if (body.fields?.lostReason) { updates.push('lost_reason = ?'); params.push(body.fields.lostReason) }
  if (body.fields?.nextContactDate) { updates.push('next_contact_date = ?'); params.push(body.fields.nextContactDate) }
  if (body.fields?.intendedServices) {
    const svcs = body.fields.intendedServices as string[]
    updates.push('intended_services = ?')
    params.push(JSON.stringify(svcs))
  }
  params.push(id)

  // 写入用户跟进记录
  const actId = uuidv4()
  const nextContactDate = (body.fields?.nextContactDate as string | undefined) ?? null

  // 用 D1 batch 保证状态更新与跟进记录写入的原子性
  const batchStmts = [
    c.env.DB.prepare(`UPDATE leads SET ${updates.join(', ')} WHERE id = ?`).bind(...params),
    nextContactDate
      ? c.env.DB.prepare(
          'INSERT INTO sales_activities (id, lead_id, user_id, activity_type, description, activity_date, next_contact_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).bind(actId, id, userId, body.activity.activityType, finalDescription, body.activity.activityDate, nextContactDate)
      : c.env.DB.prepare(
          'INSERT INTO sales_activities (id, lead_id, user_id, activity_type, description, activity_date) VALUES (?, ?, ?, ?, ?, ?)',
        ).bind(actId, id, userId, body.activity.activityType, finalDescription, body.activity.activityDate),
  ]
  await c.env.DB.batch(batchStmts)

  // 维护 current_leads_count（非关键，单独执行）
  const TERMINAL = ['Converted', 'Lost']
  if (!TERMINAL.includes(lead.status) && TERMINAL.includes(body.targetStatus) && lead.assigned_to_userId) {
    await c.env.DB.prepare(
      'UPDATE users SET current_leads_count = MAX(0, current_leads_count - 1) WHERE id = ?',
    ).bind(lead.assigned_to_userId).run()
  }

  // 处理附件（批量写入）
  const attStmts = (body.activity.attachmentKeys ?? []).map((att) =>
    c.env.DB.prepare(
      'INSERT INTO activity_attachments (id, activity_id, name, file_key, size, mime_type, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(uuidv4(), actId, att.name, att.key, att.size ?? null, att.mimeType ?? null, userId),
  )
  if (attStmts.length > 0) await c.env.DB.batch(attStmts)

  // 触发 field_change 工作流
  const transitionTriggers: Array<{ field: string; newVal: unknown }> = [
    { field: 'status', newVal: body.targetStatus },
    ...(body.fields?.lostReason      ? [{ field: 'lostReason',      newVal: body.fields.lostReason }]      : []),
    ...(body.fields?.nextContactDate  ? [{ field: 'nextContactDate',  newVal: body.fields.nextContactDate }]  : []),
  ]
  for (const { field, newVal } of transitionTriggers) {
    c.executionCtx.waitUntil(
      executeWorkflowsForTrigger(c.env.DB, c.env, 'lead', id, { type: 'field_change', field, to: String(newVal) })
        .catch((err) => console.error(`[workflow] field_change lead status-transition ${field} error:`, err)),
    )
  }

  const result = await c.env.DB.prepare(`${SELECT_COLS} ${BASE_JOIN} WHERE l.id = ?`).bind(id).first()
  return c.json({ data: parseLead(result as Record<string, unknown>) })
})

leadsRoutes.delete('/:id', requireAdmin, async (c) => {
  const { id } = c.req.param()
  const lead = await c.env.DB.prepare('SELECT id FROM leads WHERE id = ? AND deleted_at IS NULL').bind(id).first()
  if (!lead) throw new HTTPException(404, { message: '线索不存在' })
  await c.env.DB.prepare('UPDATE leads SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').bind(id).run()
  return c.json({ data: { id } })
})
