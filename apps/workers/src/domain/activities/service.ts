// 跟进记录业务服务：界面接口与 AI 助手共用。
// 负责：跟进类型校验、对关联线索/客户的权限、写库（含附件）、同步下次联系时间、里程碑推进、工作流。
import { toCamel, toCamelList } from '../../shared/db'
import type { Actor, Deps } from '../actor'
import { badRequest, notFound } from '../errors'
import { fireWorkflow } from '../workflows'
import { assertCanEditLead } from '../leads/policy'
import { assertCanEditClient } from '../clients/policy'
import { insertActivityStatement, insertAttachmentStatements, type AttachmentInput } from './records'

const ACTIVITY_SELECT = `
  SELECT sa.*, u.name as user_name, c.name as client_name, l.name as lead_name,
    (SELECT json_group_array(json_object('key', aa.r2_object_key, 'name', aa.file_name, 'size', aa.file_size))
     FROM activity_attachments aa WHERE aa.activity_id = sa.id) as raw_attachments
  FROM sales_activities sa
  LEFT JOIN users u ON sa.user_id = u.id
  LEFT JOIN clients c ON sa.client_id = c.id
  LEFT JOIN leads l ON sa.lead_id = l.id`

const ACTIVITY_COUNT_FROM = `
  FROM sales_activities sa
  LEFT JOIN users u ON sa.user_id = u.id
  LEFT JOIN clients c ON sa.client_id = c.id
  LEFT JOIN leads l ON sa.lead_id = l.id`

export type Activity = Record<string, unknown>

function parseActivity(row: Record<string, unknown>): Activity {
  const a = toCamel(row) as Record<string, unknown>
  let attachments: unknown[] = []
  if (a.rawAttachments && a.rawAttachments !== 'null') {
    try { attachments = JSON.parse(a.rawAttachments as string) } catch { attachments = [] }
  }
  let extraData: unknown = null
  if (a.extraData) {
    try { extraData = typeof a.extraData === 'string' ? JSON.parse(a.extraData) : a.extraData } catch { extraData = null }
  }
  return { ...a, attachments, extraData, rawAttachments: undefined }
}

// ─── 列表 ────────────────────────────────────────────────────────────────────

export interface ActivityListFilters {
  clientId?: string | undefined
  leadId?: string | undefined
  search?: string | undefined
  activityType?: string | undefined
  assignedUserId?: string | undefined
  entityType?: string | undefined    // lead | client
  activityDate?: string | undefined  // today | week | month
  nextContact?: string | undefined   // overdue | today | week
  page?: number | undefined
  pageSize?: number | undefined
}

export async function listActivities(db: D1Database, actor: Actor, f: ActivityListFilters) {
  const page = Math.max(1, f.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, f.pageSize ?? 20))
  const offset = (page - 1) * pageSize

  let where = 'WHERE 1=1'
  const params: unknown[] = []

  // 销售只能看自己负责的线索/客户下的跟进记录
  if (actor.role === 'sales') {
    where += ' AND (l.assigned_to_userId = ? OR c.assigned_sales_userId = ?)'
    params.push(actor.userId, actor.userId)
  }

  if (f.clientId && f.leadId) { where += ' AND (sa.client_id = ? OR sa.lead_id = ?)'; params.push(f.clientId, f.leadId) }
  else if (f.clientId) { where += ' AND sa.client_id = ?'; params.push(f.clientId) }
  else if (f.leadId) { where += ' AND sa.lead_id = ?'; params.push(f.leadId) }

  if (f.activityType) { where += ' AND sa.activity_type = ?'; params.push(f.activityType) }
  if (f.assignedUserId && actor.role !== 'sales') { where += ' AND sa.user_id = ?'; params.push(f.assignedUserId) }

  if (f.entityType === 'lead') where += ' AND sa.lead_id IS NOT NULL AND sa.client_id IS NULL'
  else if (f.entityType === 'client') where += ' AND sa.client_id IS NOT NULL'

  const now = new Date().toISOString().slice(0, 10)
  if (f.activityDate === 'today') { where += ' AND sa.activity_date >= ? AND sa.activity_date < date(?, "+1 day")'; params.push(now, now) }
  else if (f.activityDate === 'week') { where += ' AND sa.activity_date >= date(?, "-7 days") AND sa.activity_date <= ?'; params.push(now, now) }
  else if (f.activityDate === 'month') { where += ' AND sa.activity_date >= date(?, "-30 days") AND sa.activity_date <= ?'; params.push(now, now) }

  if (f.nextContact === 'overdue') { where += ' AND sa.next_contact_date IS NOT NULL AND sa.next_contact_date < ?'; params.push(now) }
  else if (f.nextContact === 'today') { where += ' AND sa.next_contact_date = ?'; params.push(now) }
  else if (f.nextContact === 'week') { where += ' AND sa.next_contact_date >= ? AND sa.next_contact_date <= date(?, "+7 days")'; params.push(now, now) }

  if (f.search) {
    where += ' AND (sa.description LIKE ? OR u.name LIKE ? OR c.name LIKE ? OR l.name LIKE ?)'
    const q = `%${f.search}%`
    params.push(q, q, q, q)
  }

  const [count, rows] = await Promise.all([
    db.prepare(`SELECT COUNT(*) as total ${ACTIVITY_COUNT_FROM} ${where}`).bind(...params).first<{ total: number }>(),
    db.prepare(`${ACTIVITY_SELECT} ${where} ORDER BY sa.created_at DESC LIMIT ? OFFSET ?`).bind(...params, pageSize, offset)
      .all<Record<string, unknown>>(),
  ])
  return { data: rows.results.map(parseActivity), total: count?.total ?? 0, page, pageSize }
}

/** 线索或客户最近的跟进记录（给 AI 助手做上下文用，调用方负责先检查实体权限） */
export async function recentActivities(db: D1Database, entity: 'lead' | 'client', id: string, limit = 10) {
  const col = entity === 'lead' ? 'lead_id' : 'client_id'
  const rows = await db.prepare(`
    SELECT sa.activity_type, sa.description, sa.activity_date, sa.next_contact_date, u.name as user_name
    FROM sales_activities sa LEFT JOIN users u ON sa.user_id = u.id
    WHERE sa.${col} = ? ORDER BY sa.activity_date DESC, sa.created_at DESC LIMIT ?
  `).bind(id, limit).all<Record<string, unknown>>()
  return toCamelList(rows.results)
}

export async function loadActivity(db: D1Database, id: string): Promise<Activity> {
  const row = await db.prepare(`${ACTIVITY_SELECT} WHERE sa.id = ?`).bind(id).first<Record<string, unknown>>()
  if (!row) throw notFound('跟进记录不存在')
  return parseActivity(row)
}

// ─── 新建 ────────────────────────────────────────────────────────────────────

export interface CreateActivityInput {
  leadId?: string | null | undefined
  clientId?: string | null | undefined
  activityType: string
  description?: string | null | undefined
  activityDate: string
  nextContactDate?: string | null | undefined
  extraData?: Record<string, unknown> | null | undefined
  attachments?: AttachmentInput[] | undefined
}

interface MilestoneMapping { stepName?: string; action: 'in_progress' | 'complete'; advanceNext?: boolean }

/** 新建跟进记录：校验 → 写库（含附件）→ 同步下次联系时间 → 里程碑推进 → 工作流。返回记录 ID */
export async function createActivity(deps: Deps, actor: Actor, input: CreateActivityInput): Promise<string> {
  const { db } = deps
  const leadId = input.leadId ?? null
  const clientId = input.clientId ?? null
  if (!leadId && !clientId) throw badRequest('跟进记录必须关联线索或客户')

  // 关联对象必须存在，且操作者有修改权限（跟进记录会改写下次联系时间）
  if (leadId) {
    const lead = await db.prepare('SELECT assigned_to_userId, assigned_to_teamId FROM leads WHERE id = ? AND deleted_at IS NULL')
      .bind(leadId).first<{ assigned_to_userId: string | null; assigned_to_teamId: string | null }>()
    if (!lead) throw notFound('线索不存在')
    assertCanEditLead(actor, lead)
  }
  if (clientId) {
    const client = await db.prepare('SELECT assigned_sales_userId FROM clients WHERE id = ? AND deleted_at IS NULL')
      .bind(clientId).first<{ assigned_sales_userId: string | null }>()
    if (!client) throw notFound('客户不存在')
    assertCanEditClient(actor, client)
  }

  const type = await db.prepare(
    "SELECT metadata FROM option_items WHERE group_key = 'activity_type' AND value = ? AND is_active = 1",
  ).bind(input.activityType).first<{ metadata: string | null }>()
  if (!type) throw badRequest(`无效的跟进类型：${input.activityType}`)
  let milestoneMapping: MilestoneMapping | null = null
  if (type.metadata) {
    try { milestoneMapping = (JSON.parse(type.metadata) as { milestoneMapping?: MilestoneMapping }).milestoneMapping ?? null } catch { /* 忽略损坏的配置 */ }
  }

  const id = crypto.randomUUID()
  const nextContactDate = input.nextContactDate ?? null
  await db.batch([
    insertActivityStatement(db, {
      id, leadId, clientId, userId: actor.userId, activityType: input.activityType,
      description: input.description ?? null, activityDate: input.activityDate, nextContactDate,
      extraData: input.extraData,
    }),
    ...insertAttachmentStatements(db, id, input.attachments ?? []),
    ...(nextContactDate && clientId ? [db.prepare('UPDATE clients SET next_contact_date = ? WHERE id = ?').bind(nextContactDate, clientId)] : []),
    ...(nextContactDate && leadId ? [db.prepare('UPDATE leads SET next_contact_date = ? WHERE id = ?').bind(nextContactDate, leadId)] : []),
  ])

  if (milestoneMapping && clientId) {
    deps.waitUntil(applyMilestoneMapping(db, clientId, milestoneMapping)
      .catch((err) => console.error('[milestone] auto-update failed:', err)))
  }
  fireWorkflow(deps, 'activity', id, { type: 'on_create' })
  return id
}

/** 根据跟进类型配置的 milestoneMapping 自动更新客户里程碑 */
async function applyMilestoneMapping(db: D1Database, clientId: string, mapping: MilestoneMapping) {
  const now = new Date().toISOString().slice(0, 10)

  const milestone = mapping.stepName
    // 按步骤名匹配（取第一个未完成的同名步骤）
    ? await db.prepare(
        `SELECT id, step_index, service_id FROM client_milestones
         WHERE client_id = ? AND step_name = ? AND status != 'completed' ORDER BY step_index ASC LIMIT 1`,
      ).bind(clientId, mapping.stepName).first<{ id: string; step_index: number; service_id: string }>()
    // 无步骤名则匹配当前进行中的步骤
    : await db.prepare(
        `SELECT id, step_index, service_id FROM client_milestones
         WHERE client_id = ? AND status = 'in_progress' ORDER BY step_index ASC LIMIT 1`,
      ).bind(clientId).first<{ id: string; step_index: number; service_id: string }>()
  if (!milestone) return

  if (mapping.action === 'complete') {
    await db.prepare(`UPDATE client_milestones SET status = 'completed', completed_date = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(now, milestone.id).run()
    if (mapping.advanceNext !== false) {
      await db.prepare(
        `UPDATE client_milestones SET status = 'in_progress', updated_at = datetime('now')
         WHERE client_id = ? AND service_id = ? AND step_index = ? AND status = 'pending'`,
      ).bind(clientId, milestone.service_id, milestone.step_index + 1).run()
    }
  } else {
    await db.prepare(`UPDATE client_milestones SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?`)
      .bind(milestone.id).run()
  }
}
