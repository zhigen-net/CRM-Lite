// 线索业务服务：所有入口（界面接口、对外接口、失败补录、AI 助手）都通过这里读写线索。
// 参数校验、权限、写库以及附带处理（线索数、变更记录、分配队列、工作流）只在这里实现。
import { v4 as uuidv4 } from 'uuid'
import { toCamel } from '../../shared/db'
import type { Actor, Deps } from '../actor'
import { badRequest, forbidden, notFound } from '../errors'
import { fireWorkflow } from '../workflows'
import { insertActivityStatement, insertAttachmentStatements, insertSystemActivityStatement, type AttachmentInput } from '../activities/records'
import { assertCanChangeLeadTeam, assertCanEditLead, assertCanViewLead, leadVisibility } from './policy'
import { assertDate, assertDateTime, assertOptionValue } from '../validation'
import { linkVisitorStatement, parseVisitorId } from '../tracking/link'

// 与 leads 表的 CHECK 约束一致
export const LEAD_STATUSES = ['New', 'Contacted', 'Qualified', 'Converted', 'Lost'] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]
const TERMINAL: readonly string[] = ['Converted', 'Lost']

const STATUS_LABELS: Record<string, string> = {
  New: '新线索', Contacted: '已联系', Qualified: '已确认', Converted: '已转化', Lost: '已丢失',
}

const BASE_JOIN = 'FROM leads l LEFT JOIN users u ON l.created_by_userId = u.id LEFT JOIN users assign_u ON l.assigned_to_userId = assign_u.id'
const SELECT_COLS = 'SELECT l.*, u.name as created_by_name, assign_u.name as assigned_to_name, (SELECT COUNT(*) FROM sales_activities WHERE lead_id = l.id) as activity_count'

interface LeadRow {
  id: string
  name: string
  source: string
  status: string
  notes: string | null
  contact_info: string
  intended_services: string
  assigned_to_userId: string | null
  assigned_to_teamId: string | null
  next_contact_date: string | null
  lost_reason: string | null
}

export type Lead = Record<string, unknown>

function parseLead(row: Record<string, unknown>): Lead {
  const lead = toCamel(row) as Record<string, unknown>
  if (typeof lead.intendedServices === 'string') {
    try { lead.intendedServices = JSON.parse(lead.intendedServices as string) } catch { lead.intendedServices = [] }
  }
  if (typeof lead.adInfo === 'string') {
    try { lead.adInfo = JSON.parse(lead.adInfo as string) } catch { lead.adInfo = null }
  }
  return lead
}

function assertValidStatus(status: string): asserts status is LeadStatus {
  if (!(LEAD_STATUSES as readonly string[]).includes(status)) {
    throw badRequest(`无效的线索状态：${status}，可选值：${LEAD_STATUSES.join(' / ')}`)
  }
}

export async function findActiveLead(db: D1Database, id: string): Promise<LeadRow> {
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ? AND deleted_at IS NULL').bind(id).first<LeadRow>()
  if (!lead) throw notFound('线索不存在')
  return lead
}

export async function adjustLeadsCount(db: D1Database, userId: string, delta: 1 | -1) {
  const sql = delta > 0
    ? 'UPDATE users SET current_leads_count = current_leads_count + 1 WHERE id = ?'
    : 'UPDATE users SET current_leads_count = MAX(0, current_leads_count - 1) WHERE id = ?'
  await db.prepare(sql).bind(userId).run()
}

// ─── 读取 ────────────────────────────────────────────────────────────────────

export interface LeadListFilters {
  status?: string | undefined
  mine?: boolean | undefined
  search?: string | undefined
  source?: string | undefined
  assignedTo?: string | undefined
  nextContact?: string | undefined  // overdue | today | week
  createdAt?: string | undefined  // today | week | month
  activityCount?: string | undefined  // 0 | 1-3 | 3+
  service?: string | undefined
  page?: number | undefined
  pageSize?: number | undefined
}

export async function listLeads(db: D1Database, actor: Actor, f: LeadListFilters): Promise<{ data: Lead[]; total: number; page: number; pageSize: number }> {
  const page = f.page ?? 1
  const pageSize = f.pageSize ?? 20
  const offset = (page - 1) * pageSize

  const scope = leadVisibility(actor)
  let where = 'WHERE l.deleted_at IS NULL' + scope.sql
  const params: unknown[] = [...scope.params]

  if (actor.role !== 'sales' && f.mine) { where += ' AND l.assigned_to_userId = ?'; params.push(actor.userId) }
  if (f.status) { where += ' AND l.status = ?'; params.push(f.status) }
  if (f.source) { where += ' AND l.source = ?'; params.push(f.source) }
  if (f.assignedTo) { where += ' AND l.assigned_to_userId = ?'; params.push(f.assignedTo) }

  if (f.nextContact === 'overdue') where += " AND l.next_contact_date IS NOT NULL AND l.next_contact_date < date('now')"
  else if (f.nextContact === 'today') where += " AND l.next_contact_date = date('now')"
  else if (f.nextContact === 'week') where += " AND l.next_contact_date IS NOT NULL AND l.next_contact_date BETWEEN date('now') AND date('now', '+7 days')"

  if (f.createdAt === 'today') where += " AND DATE(l.created_at) = DATE('now')"
  else if (f.createdAt === 'week') where += " AND DATE(l.created_at) >= DATE('now', '-7 days')"
  else if (f.createdAt === 'month') where += " AND DATE(l.created_at) >= DATE('now', '-30 days')"

  if (f.activityCount === '0') where += ' AND (SELECT COUNT(*) FROM sales_activities WHERE lead_id = l.id) = 0'
  else if (f.activityCount === '1-3') where += ' AND (SELECT COUNT(*) FROM sales_activities WHERE lead_id = l.id) BETWEEN 1 AND 3'
  else if (f.activityCount === '3+') where += ' AND (SELECT COUNT(*) FROM sales_activities WHERE lead_id = l.id) > 3'

  if (f.service) { where += ' AND l.intended_services LIKE ?'; params.push(`%${f.service}%`) }
  if (f.search) {
    where += ' AND (l.name LIKE ? OR l.contact_info LIKE ? OR l.source LIKE ? OR CAST(l.lead_no AS TEXT) LIKE ?)'
    const q = `%${f.search}%`
    params.push(q, q, q, q)
  }

  const [rows, count] = await Promise.all([
    db.prepare(`${SELECT_COLS} ${BASE_JOIN} ${where} ORDER BY l.created_at DESC LIMIT ? OFFSET ?`)
      .bind(...params, pageSize, offset).all<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) as total ${BASE_JOIN} ${where}`).bind(...params).first<{ total: number }>(),
  ])
  return { data: rows.results.map(parseLead), total: count?.total ?? 0, page, pageSize }
}

/** 导航栏"新线索"角标：只做一次走索引的 COUNT，可见范围与列表一致 */
export async function countNewLeads(db: D1Database, actor: Actor): Promise<number> {
  const scope = leadVisibility(actor)
  const row = await db.prepare(`SELECT COUNT(*) AS total FROM leads l WHERE l.deleted_at IS NULL AND l.status = 'New'${scope.sql}`)
    .bind(...scope.params).first<{ total: number }>()
  return row?.total ?? 0
}

/** 读取线索并检查可见权限 */
export async function getLead(db: D1Database, actor: Actor, id: string): Promise<Lead> {
  const row = await db.prepare(`${SELECT_COLS} ${BASE_JOIN} WHERE l.id = ? AND l.deleted_at IS NULL`)
    .bind(id).first<Record<string, unknown> & LeadRow>()
  if (!row) throw notFound('线索不存在')
  assertCanViewLead(actor, row)
  return parseLead(row)
}

/** 写操作完成后返回最新数据（不再做可见检查：例如刚把线索转给别人的销售） */
export async function loadLead(db: D1Database, id: string): Promise<Lead> {
  const row = await db.prepare(`${SELECT_COLS} ${BASE_JOIN} WHERE l.id = ?`).bind(id).first<Record<string, unknown>>()
  if (!row) throw notFound('线索不存在')
  return parseLead(row)
}

// ─── 新建 ────────────────────────────────────────────────────────────────────

export interface CreateLeadInput {
  source: string
  name: string
  contactInfo: string
  intendedServices: string[]
  notes?: string | null | undefined
  adInfo?: Record<string, string> | null | undefined
  /** 预关联创建人所属团队（界面新建时使用） */
  linkCreatorTeam?: boolean | undefined
  /** 网站访客 ID（访客统计脚本加到表单里的 crm_vid），用于关联来源与访问轨迹 */
  visitorId?: string | null | undefined
}

/** 新建线索：写库 → 进入自动分配队列 → 触发"新建"类工作流。返回线索 ID */
export async function createLead(deps: Deps, actor: Actor, input: CreateLeadInput): Promise<string> {
  const id = uuidv4()

  let teamId: string | null = null
  if (input.linkCreatorTeam) {
    const creator = await deps.db.prepare('SELECT team_id FROM users WHERE id = ?').bind(actor.userId).first<{ team_id: string | null }>()
    teamId = creator?.team_id ?? null
  }

  const visitorId = parseVisitorId(input.visitorId)
  const insert = deps.db.prepare(
    `INSERT INTO leads (id, source, name, contact_info, intended_services, status, notes, ad_info, created_by_userId, assigned_to_teamId, visitor_id, lead_no)
     VALUES (?, ?, ?, ?, ?, 'New', ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(lead_no), 0) + 1 FROM leads))`,
  ).bind(
    id, input.source, input.name, input.contactInfo,
    JSON.stringify(input.intendedServices),
    input.notes ?? null,
    input.adInfo && Object.keys(input.adInfo).length > 0 ? JSON.stringify(input.adInfo) : null,
    actor.userId, teamId, visitorId,
  )
  await deps.db.batch(visitorId ? [insert, linkVisitorStatement(deps.db, visitorId, id)] : [insert])

  // 线索已入库：分配队列失败只记录日志，不让整个请求失败（分配可在界面上手动完成）
  try {
    await deps.env.LEAD_ASSIGNMENT_QUEUE.send({ leadId: id })
  } catch (err) {
    console.error(`[leads] 推送分配队列失败 ${id}:`, err)
  }
  fireWorkflow(deps, 'lead', id, { type: 'on_create' })
  return id
}

// ─── 修改 ────────────────────────────────────────────────────────────────────

export interface UpdateLeadPatch {
  name?: string | undefined
  status?: string | undefined
  lostReason?: string | null | undefined
  source?: string | undefined
  notes?: string | null | undefined
  assignedToUserId?: string | null | undefined
  assignedToTeamId?: string | null | undefined
  contactInfo?: string | undefined
  intendedServices?: string[] | undefined
  adInfo?: Record<string, string> | null | undefined
  nextContactDate?: string | null | undefined
}

/** 修改线索，并维护线索数、写系统变更记录、触发"字段变化"类工作流 */
export async function updateLead(deps: Deps, actor: Actor, id: string, patch: UpdateLeadPatch): Promise<void> {
  const { db } = deps
  const lead = await findActiveLead(db, id)
  if (lead.status === 'Converted') throw forbidden('线索已转化，不可修改')
  assertCanEditLead(actor, lead)
  // 工作流发起的修改：不写系统变更记录（无操作人），也不再触发工作流（避免循环）
  const byWorkflow = actor.via === 'workflow'

  if (patch.status !== undefined) assertValidStatus(patch.status)
  // 基本信息：姓名、联系方式、来源不能改成空
  for (const [k, label] of [['name', '姓名'], ['contactInfo', '联系方式'], ['source', '来源']] as const) {
    const v = patch[k]
    if (v !== undefined) {
      if (!v.trim()) throw badRequest(`${label}不能为空`)
      patch[k] = v.trim()
    }
  }
  assertDate(patch.nextContactDate, '下次联系时间')
  // 只校验有变化的值：历史数据里已停用的选项，原样保存时不应报错
  if (patch.lostReason !== undefined && patch.lostReason !== lead.lost_reason) {
    await assertOptionValue(db, 'lost_reason', patch.lostReason, '丢失原因')
  }

  if (patch.assignedToUserId !== undefined && patch.assignedToUserId !== null) {
    // 被指派人必须有效，且属于该线索的团队（同时变更团队时除外）
    const target = await db.prepare('SELECT team_id FROM users WHERE id = ? AND is_active = 1')
      .bind(patch.assignedToUserId).first<{ team_id: string | null }>()
    if (!target) throw badRequest('指派目标用户不存在或已停用')
    const changingTeam = patch.assignedToTeamId !== undefined
    // 工作流由管理员配置，保留原有行为：允许直接指派给其它团队的人
    if (!byWorkflow && !changingTeam && lead.assigned_to_teamId && target.team_id !== lead.assigned_to_teamId) {
      throw badRequest('只能指派给本团队的销售，如需跨团队请同时指定新团队（assignedToTeamId）')
    }
  }
  if (patch.assignedToTeamId !== undefined && patch.assignedToTeamId !== null) assertCanChangeLeadTeam(actor)

  const sets: string[] = ['updated_at = CURRENT_TIMESTAMP']
  const params: unknown[] = []
  const set = (col: string, val: unknown) => { sets.push(`${col} = ?`); params.push(val) }

  if (patch.name !== undefined) set('name', patch.name)
  if (patch.status !== undefined) set('status', patch.status)
  if (patch.lostReason !== undefined) set('lost_reason', patch.lostReason)
  if (patch.source !== undefined) set('source', patch.source)
  if (patch.notes !== undefined) set('notes', patch.notes)
  if (patch.assignedToUserId !== undefined) set('assigned_to_userId', patch.assignedToUserId)
  if (patch.assignedToTeamId !== undefined) set('assigned_to_teamId', patch.assignedToTeamId)
  if (patch.contactInfo !== undefined) set('contact_info', patch.contactInfo)
  if (patch.intendedServices !== undefined) set('intended_services', JSON.stringify(patch.intendedServices))
  if (patch.adInfo !== undefined) set('ad_info', patch.adInfo === null ? null : JSON.stringify(patch.adInfo))
  if (patch.nextContactDate !== undefined) set('next_contact_date', patch.nextContactDate)

  params.push(id)
  await db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run()

  // 线索数：活跃线索变为终态 → 原负责人 -1；活跃线索换负责人 → 旧 -1、新 +1
  const wasActive = !TERMINAL.includes(lead.status)
  const newStatus = patch.status ?? lead.status
  const reassigning = patch.assignedToUserId !== undefined && patch.assignedToUserId !== lead.assigned_to_userId
  if (wasActive && TERMINAL.includes(newStatus)) {
    if (lead.assigned_to_userId) await adjustLeadsCount(db, lead.assigned_to_userId, -1)
  } else if (wasActive && reassigning) {
    if (lead.assigned_to_userId) await adjustLeadsCount(db, lead.assigned_to_userId, -1)
    if (patch.assignedToUserId) await adjustLeadsCount(db, patch.assignedToUserId, 1)
  }

  // 系统变更记录
  const oldServices = (() => { try { return JSON.parse(lead.intended_services) as string[] } catch { return [] } })()
  const changes: string[] = []
  if (patch.status !== undefined && patch.status !== lead.status) changes.push(`状态→${STATUS_LABELS[patch.status] ?? patch.status}`)
  if (patch.name !== undefined && patch.name !== lead.name) changes.push(`姓名：${lead.name} → ${patch.name}`)
  if (patch.source !== undefined && patch.source !== lead.source) changes.push(`来源：${lead.source} → ${patch.source}`)
  if (patch.notes !== undefined && patch.notes !== lead.notes) changes.push('备注已更新')
  if (patch.contactInfo !== undefined && patch.contactInfo !== lead.contact_info) changes.push(`联系方式：${lead.contact_info} → ${patch.contactInfo}`)
  if (patch.intendedServices !== undefined && JSON.stringify(patch.intendedServices) !== JSON.stringify(oldServices)) {
    changes.push(`意向服务：${oldServices.join('、')} → ${patch.intendedServices.join('、')}`)
  }
  if (patch.assignedToUserId !== undefined && patch.assignedToUserId !== lead.assigned_to_userId) changes.push('负责人已变更')
  if (patch.nextContactDate !== undefined && patch.nextContactDate !== lead.next_contact_date) {
    changes.push(`下次联系→${patch.nextContactDate ?? '无'}`)
  }
  if (changes.length > 0 && !byWorkflow) {
    await insertSystemActivityStatement(db, { leadId: id }, actor.userId, changes.join('；')).run()
  }

  // "字段变化"类工作流
  const fieldChanges: Array<[string, unknown, unknown]> = [
    ['status', lead.status, patch.status],
    ['assignedToUserId', lead.assigned_to_userId, patch.assignedToUserId],
    ['nextContactDate', lead.next_contact_date, patch.nextContactDate],
  ]
  for (const [field, oldVal, newVal] of fieldChanges) {
    if (!byWorkflow && newVal !== undefined && newVal !== null && newVal !== oldVal) {
      fireWorkflow(deps, 'lead', id, { type: 'field_change', field, to: String(newVal) })
    }
  }
}

// ─── 状态流转（带跟进记录） ─────────────────────────────────────────────────

export interface StatusTransitionInput {
  targetStatus: string
  activity: {
    activityType: string
    description?: string | undefined
    activityDate: string
    attachmentKeys?: AttachmentInput[] | undefined
  }
  fields?: { lostReason?: string | undefined; nextContactDate?: string | undefined; intendedServices?: string[] | undefined; [k: string]: unknown } | undefined
}

const FIELD_LABELS: Record<string, string> = { lostReason: '丢失原因', nextContactDate: '下次联系', intendedServices: '意向服务' }

/** 变更状态并同时写一条跟进记录（状态与跟进记录原子写入） */
export async function transitionLeadStatus(deps: Deps, actor: Actor, id: string, body: StatusTransitionInput): Promise<void> {
  const { db } = deps
  const lead = await findActiveLead(db, id)
  if (lead.status === 'Converted') throw forbidden('线索已转化，不可修改')
  assertCanEditLead(actor, lead)
  assertValidStatus(body.targetStatus)
  if (!body.activity?.activityType || !body.activity.activityDate) throw badRequest('缺少跟进记录')
  assertDateTime(body.activity.activityDate, '跟进时间')

  const fields = body.fields ?? {}
  assertDate(fields.nextContactDate, '下次联系时间')
  await assertOptionValue(db, 'lost_reason', fields.lostReason, '丢失原因')

  // 把字段值拼进跟进描述，让跟进列表信息完整
  const fieldLines: string[] = []
  for (const [key, val] of Object.entries(fields)) {
    if (val === undefined || val === null || val === '') continue
    fieldLines.push(`${FIELD_LABELS[key] ?? key}：${Array.isArray(val) ? (val as string[]).join('、') : val}`)
  }
  const description = [body.activity.description?.trim() ?? '', ...fieldLines].filter(Boolean).join('\n') || null

  const sets = ['status = ?', 'updated_at = CURRENT_TIMESTAMP']
  const params: unknown[] = [body.targetStatus]
  if (fields.lostReason) { sets.push('lost_reason = ?'); params.push(fields.lostReason) }
  if (fields.nextContactDate) { sets.push('next_contact_date = ?'); params.push(fields.nextContactDate) }
  if (fields.intendedServices) { sets.push('intended_services = ?'); params.push(JSON.stringify(fields.intendedServices)) }
  params.push(id)

  // 状态、跟进记录、附件在同一个 batch 中原子写入
  const actId = uuidv4()
  await db.batch([
    db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).bind(...params),
    insertActivityStatement(db, {
      id: actId, leadId: id, clientId: null, userId: actor.userId,
      activityType: body.activity.activityType, description,
      activityDate: body.activity.activityDate, nextContactDate: fields.nextContactDate ?? null,
    }),
    ...insertAttachmentStatements(db, actId, body.activity.attachmentKeys ?? []),
  ])

  if (!TERMINAL.includes(lead.status) && TERMINAL.includes(body.targetStatus) && lead.assigned_to_userId) {
    await adjustLeadsCount(db, lead.assigned_to_userId, -1)
  }

  const triggers: Array<[string, unknown]> = [
    ['status', body.targetStatus],
    ...(fields.lostReason ? [['lostReason', fields.lostReason] as [string, unknown]] : []),
    ...(fields.nextContactDate ? [['nextContactDate', fields.nextContactDate] as [string, unknown]] : []),
  ]
  for (const [field, val] of triggers) {
    fireWorkflow(deps, 'lead', id, { type: 'field_change', field, to: String(val) })
  }
}

// ─── 删除（软删除） ──────────────────────────────────────────────────────────

/** 按实际数据重新统计某人负责的进行中线索数（幂等，可纠正历史偏差） */
export async function recountLeads(db: D1Database, userId: string): Promise<void> {
  await db.prepare(
    `UPDATE users SET current_leads_count = (
       SELECT COUNT(*) FROM leads l
       WHERE l.assigned_to_userId = users.id AND l.deleted_at IS NULL AND l.status NOT IN ('Converted', 'Lost'))
     WHERE id = ?`,
  ).bind(userId).run()
}

export async function softDeleteLead(db: D1Database, actor: Actor, id: string): Promise<void> {
  if (actor.role !== 'admin') throw forbidden('权限不足')
  const lead = await findActiveLead(db, id)
  await db.prepare('UPDATE leads SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL').bind(id).run()
  // 重新统计而不是 -1：重复请求、历史上未同步的删除都不会让计数出错
  if (lead.assigned_to_userId) await recountLeads(db, lead.assigned_to_userId)
}

/** 从回收站恢复线索，并重新统计负责人线索数 */
export async function restoreLead(db: D1Database, actor: Actor, id: string): Promise<void> {
  if (actor.role !== 'admin') throw forbidden('权限不足')
  const lead = await db.prepare('SELECT * FROM leads WHERE id = ? AND deleted_at IS NOT NULL').bind(id).first<LeadRow>()
  if (!lead) throw notFound('记录不存在或未被删除')
  await db.prepare('UPDATE leads SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL').bind(id).run()
  // 重新统计而不是 +1：同时点两次恢复、在旧版本中删除的线索，计数都保持正确
  if (lead.assigned_to_userId) await recountLeads(db, lead.assigned_to_userId)
}
