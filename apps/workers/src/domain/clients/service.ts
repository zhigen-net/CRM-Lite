// 客户业务服务：界面接口与 AI 助手共用。
// 负责：可见范围与修改权限、线索转化、写库及附带处理（变更记录、线索数、工作流）。
import { toCamel } from '../../shared/db'
import { assertDate, assertOptionValue } from '../validation'
import type { Actor, Deps } from '../actor'
import { DomainError, forbidden, notFound } from '../errors'
import { fireWorkflow } from '../workflows'
import { insertSystemActivityStatement } from '../activities/records'
import { assertCanEditLead } from '../leads/policy'
import { adjustLeadsCount, findActiveLead } from '../leads/service'
import { assertCanEditClient, assertCanViewClient, clientVisibility } from './policy'

const BASE_JOIN = 'FROM clients c LEFT JOIN users u ON c.created_by_userId = u.id LEFT JOIN users s ON c.assigned_sales_userId = s.id LEFT JOIN leads l ON c.lead_id = l.id'
const SELECT_COLS = 'SELECT c.*, u.name as created_by_name, s.name as assigned_sales_name, l.lead_no'

export type Client = Record<string, unknown>

interface ClientRow {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  service_plans: string
  contract_status: string | null
  assigned_sales_userId: string | null
  next_contact_date: string | null
}

function parseClient(row: Record<string, unknown>): Client {
  const client = toCamel(row) as Record<string, unknown>
  if (typeof client.detailedProfile === 'string') {
    try { client.detailedProfile = JSON.parse(client.detailedProfile as string) } catch { client.detailedProfile = {} }
  }
  if (typeof client.servicePlans === 'string') {
    try { client.servicePlans = JSON.parse(client.servicePlans as string) } catch { client.servicePlans = [] }
  }
  return client
}

async function findActiveClient(db: D1Database, id: string): Promise<ClientRow> {
  const row = await db.prepare('SELECT * FROM clients WHERE id = ? AND deleted_at IS NULL').bind(id).first<ClientRow>()
  if (!row) throw notFound('客户不存在')
  return row
}

// ─── 读取 ────────────────────────────────────────────────────────────────────

export interface ClientListFilters {
  search?: string | undefined
  contractStatus?: string | undefined
  assignedSalesUserId?: string | undefined
  createdAt?: string | undefined      // today | week | month
  nextContact?: string | undefined    // overdue | today | week
  page?: number | undefined
  pageSize?: number | undefined
}

export async function listClients(db: D1Database, actor: Actor, f: ClientListFilters) {
  const page = f.page ?? 1
  const pageSize = f.pageSize ?? 20
  const offset = (page - 1) * pageSize

  const scope = clientVisibility(actor)
  let where = 'WHERE c.deleted_at IS NULL' + scope.sql
  const params: unknown[] = [...scope.params]

  if (f.search) {
    where += ' AND (c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)'
    const q = `%${f.search}%`
    params.push(q, q, q)
  }
  if (f.contractStatus) { where += ' AND c.contract_status = ?'; params.push(f.contractStatus) }
  if (f.assignedSalesUserId && actor.role !== 'sales') { where += ' AND c.assigned_sales_userId = ?'; params.push(f.assignedSalesUserId) }

  const now = new Date().toISOString().slice(0, 10)
  if (f.createdAt === 'today') { where += ' AND date(c.created_at) = ?'; params.push(now) }
  else if (f.createdAt === 'week') { where += ' AND c.created_at >= date(?, "-7 days")'; params.push(now) }
  else if (f.createdAt === 'month') { where += ' AND c.created_at >= date(?, "-30 days")'; params.push(now) }

  if (f.nextContact === 'overdue') { where += ' AND c.next_contact_date IS NOT NULL AND c.next_contact_date < ?'; params.push(now) }
  else if (f.nextContact === 'today') { where += ' AND c.next_contact_date = ?'; params.push(now) }
  else if (f.nextContact === 'week') { where += ' AND c.next_contact_date >= ? AND c.next_contact_date <= date(?, "+7 days")'; params.push(now, now) }

  const [rows, count] = await Promise.all([
    db.prepare(`${SELECT_COLS} ${BASE_JOIN} ${where} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`)
      .bind(...params, pageSize, offset).all<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) as total FROM clients c ${where}`).bind(...params).first<{ total: number }>(),
  ])
  return { data: rows.results.map(parseClient), total: count?.total ?? 0, page, pageSize }
}

export async function getClient(db: D1Database, actor: Actor, id: string): Promise<Client> {
  const row = await db.prepare(`${SELECT_COLS} ${BASE_JOIN} WHERE c.id = ? AND c.deleted_at IS NULL`)
    .bind(id).first<Record<string, unknown> & ClientRow>()
  if (!row) throw notFound('客户不存在')
  assertCanViewClient(actor, row)
  return parseClient(row)
}

export async function loadClient(db: D1Database, id: string): Promise<Client> {
  const row = await db.prepare(`${SELECT_COLS} ${BASE_JOIN} WHERE c.id = ?`).bind(id).first<Record<string, unknown>>()
  if (!row) throw notFound('客户不存在')
  return parseClient(row)
}

// ─── 新建 / 线索转化 ─────────────────────────────────────────────────────────

export interface CreateClientInput {
  leadId?: string | null | undefined
  name: string
  email?: string | null | undefined
  phone?: string | null | undefined
  detailedProfile?: Record<string, unknown> | undefined
  servicePlans?: string[] | undefined
  assignedSalesUserId?: string | null | undefined
}

/**
 * 新建客户；带 leadId 时为线索转化：线索标记为已转化、负责人线索数 -1、
 * 跟进记录迁移到客户、写转化记录。返回客户 ID
 */
export async function createClient(deps: Deps, actor: Actor, input: CreateClientInput): Promise<string> {
  const { db } = deps
  let lead: Awaited<ReturnType<typeof findActiveLead>> & { notes?: string | null; source?: string | null } | null = null
  if (input.leadId) {
    lead = await findActiveLead(db, input.leadId)
    if (lead.status === 'Converted') throw new DomainError(409, '线索已转化，不能重复转化')
    assertCanEditLead(actor, lead)
  }

  const id = crypto.randomUUID()
  const servicePlans = input.servicePlans ?? []
  const detailedProfile = JSON.stringify({
    ...(input.detailedProfile ?? {}),
    notes: lead?.notes ?? null,
    source: lead?.source ?? null,
  })

  await db.prepare(
    `INSERT INTO clients (id, lead_id, name, email, phone, detailed_profile, service_plan, service_plans, assigned_sales_userId, created_by_userId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, input.leadId ?? null, input.name, input.email ?? null, input.phone ?? null, detailedProfile,
    servicePlans[0] ?? null,   // 旧列兼容
    JSON.stringify(servicePlans), input.assignedSalesUserId ?? null, actor.userId,
  ).run()

  if (lead && input.leadId) {
    await db.batch([
      db.prepare("UPDATE leads SET status = 'Converted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(input.leadId),
      // 线索下的跟进记录关联到新客户
      db.prepare('UPDATE sales_activities SET client_id = ? WHERE lead_id = ? AND client_id IS NULL').bind(id, input.leadId),
      insertSystemActivityStatement(db, { leadId: input.leadId, clientId: id }, actor.userId, '线索已转化为客户'),
    ])
    if (lead.status !== 'Lost' && lead.assigned_to_userId) await adjustLeadsCount(db, lead.assigned_to_userId, -1)
    fireWorkflow(deps, 'lead', input.leadId, { type: 'field_change', field: 'status', to: 'Converted' })
  }

  fireWorkflow(deps, 'client', id, { type: 'on_create' })
  return id
}

// ─── 修改 ────────────────────────────────────────────────────────────────────

export interface UpdateClientPatch {
  name?: string | undefined
  email?: string | null | undefined
  phone?: string | null | undefined
  detailedProfile?: Record<string, unknown> | undefined
  servicePlans?: string[] | undefined
  contractStatus?: string | null | undefined
  assignedSalesUserId?: string | null | undefined
  nextContactDate?: string | null | undefined
}

/** 修改客户，写系统变更记录，触发"字段变化"类工作流 */
export async function updateClient(deps: Deps, actor: Actor, id: string, patch: UpdateClientPatch): Promise<void> {
  const { db } = deps
  const existing = await findActiveClient(db, id)
  assertCanEditClient(actor, existing)
  // 工作流发起的修改：不写系统变更记录（无操作人），也不再触发工作流（避免循环）
  const byWorkflow = actor.via === 'workflow'
  assertDate(patch.nextContactDate, '下次联系时间')
  // 只校验有变化的值：历史数据里已停用的选项，原样保存时不应报错
  if (patch.contractStatus !== undefined && patch.contractStatus !== existing.contract_status) {
    await assertOptionValue(db, 'contract_status', patch.contractStatus, '合同状态')
  }

  const sets: string[] = ['updated_at = CURRENT_TIMESTAMP']
  const params: unknown[] = []
  const set = (col: string, val: unknown) => { sets.push(`${col} = ?`); params.push(val) }

  if (patch.name !== undefined) set('name', patch.name)
  if (patch.email !== undefined) set('email', patch.email)
  if (patch.phone !== undefined) set('phone', patch.phone)
  if (patch.detailedProfile !== undefined) set('detailed_profile', JSON.stringify(patch.detailedProfile))
  if (patch.servicePlans !== undefined) {
    set('service_plans', JSON.stringify(patch.servicePlans))
    set('service_plan', patch.servicePlans[0] ?? null)
  }
  if (patch.contractStatus !== undefined) set('contract_status', patch.contractStatus)
  if (patch.assignedSalesUserId !== undefined) set('assigned_sales_userId', patch.assignedSalesUserId)
  if (patch.nextContactDate !== undefined) set('next_contact_date', patch.nextContactDate)

  params.push(id)
  await db.prepare(`UPDATE clients SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run()

  // 只记录实际发生变化的字段
  const oldPlans: string[] = (() => { try { return JSON.parse(existing.service_plans) } catch { return [] } })()
  const changes: string[] = []
  if (patch.name !== undefined && patch.name !== existing.name) changes.push(`姓名：${existing.name ?? '（空）'} → ${patch.name}`)
  if (patch.phone !== undefined && patch.phone !== existing.phone) changes.push(`电话：${existing.phone ?? '（空）'} → ${patch.phone ?? '（已清除）'}`)
  if (patch.email !== undefined && patch.email !== existing.email) changes.push(`邮箱：${existing.email ?? '（空）'} → ${patch.email ?? '（已清除）'}`)
  if (patch.servicePlans !== undefined && JSON.stringify(patch.servicePlans) !== JSON.stringify(oldPlans)) {
    changes.push(`服务套餐：${oldPlans.join('、') || '（空）'} → ${patch.servicePlans.join('、') || '（已清除）'}`)
  }
  if (patch.contractStatus !== undefined && patch.contractStatus !== existing.contract_status) {
    changes.push(`合同状态：${existing.contract_status ?? '（空）'} → ${patch.contractStatus ?? '（已清除）'}`)
  }
  if (patch.nextContactDate !== undefined && patch.nextContactDate !== existing.next_contact_date) {
    changes.push(`下次联系→${patch.nextContactDate ?? '无'}`)
  }
  if (patch.assignedSalesUserId !== undefined && patch.assignedSalesUserId !== existing.assigned_sales_userId) {
    const name = async (uid: string | null) => uid
      ? (await db.prepare('SELECT name FROM users WHERE id = ?').bind(uid).first<{ name: string }>())?.name ?? null
      : null
    const [oldName, newName] = await Promise.all([name(existing.assigned_sales_userId), name(patch.assignedSalesUserId)])
    changes.push(`负责人：${oldName ?? '（未分配）'} → ${newName ?? '（未分配）'}`)
  }
  if (changes.length > 0 && !byWorkflow) {
    await insertSystemActivityStatement(db, { clientId: id }, actor.userId, changes.join('；')).run()
  }

  const fieldChanges: Array<[string, unknown, unknown]> = [
    ['contractStatus', existing.contract_status, patch.contractStatus],
    ['assignedSalesUserId', existing.assigned_sales_userId, patch.assignedSalesUserId],
    ['name', existing.name, patch.name],
    ['phone', existing.phone, patch.phone],
    ['nextContactDate', existing.next_contact_date, patch.nextContactDate],
  ]
  for (const [field, oldVal, newVal] of fieldChanges) {
    if (!byWorkflow && newVal !== undefined && newVal !== null && newVal !== oldVal) {
      fireWorkflow(deps, 'client', id, { type: 'field_change', field, to: String(newVal) })
    }
  }
}

// ─── 删除（软删除） ──────────────────────────────────────────────────────────

export async function softDeleteClient(db: D1Database, actor: Actor, id: string): Promise<void> {
  if (actor.role !== 'admin') throw forbidden('权限不足')
  await findActiveClient(db, id)
  await db.prepare('UPDATE clients SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').bind(id).run()
}
