import { v4 as uuidv4 } from 'uuid'
import { toCamel, toCamelList } from '../../shared/db'
import { actorFromJwt, type Role } from '../../domain/actor'
import { DomainError } from '../../domain/errors'
import * as leads from '../../domain/leads/service'

export interface AgentContext {
  db: D1Database
  env: Env
  userId: string
  role: Role
  teamId: string | null
  waitUntil(promise: Promise<unknown>): void
}

const actorOf = (ctx: AgentContext) => actorFromJwt(ctx, 'assistant')
const depsOf = (ctx: AgentContext) => ({ db: ctx.db, env: ctx.env, waitUntil: ctx.waitUntil })

type ToolInput = Record<string, unknown>
type ToolResult = unknown

export async function executeTool(ctx: AgentContext, toolName: string, input: ToolInput): Promise<ToolResult> {
  try {
    return await dispatch(ctx, toolName, input)
  } catch (err) {
    // 业务错误（无权限、参数无效等）以 { error } 返回给模型，让它能据此调整
    if (err instanceof DomainError) return { error: err.message }
    throw err
  }
}

async function dispatch(ctx: AgentContext, toolName: string, input: ToolInput): Promise<ToolResult> {
  switch (toolName) {
    case 'query_leads':      return queryLeads(ctx, input)
    case 'get_lead':         return getLead(ctx, input)
    case 'query_clients':    return queryClients(ctx, input)
    case 'get_client':       return getClient(ctx, input)
    case 'create_activity':  return createActivity(ctx, input)
    case 'update_lead':      return updateLead(ctx, input)
    case 'update_client':    return updateClient(ctx, input)
    case 'get_options':      return getOptions(ctx, input)
    case 'query_users':      return queryUsers(ctx, input)
    default: return { error: `未知工具：${toolName}` }
  }
}

// ─── 查询线索（可见范围与界面一致，由 domain/leads 决定） ───────────────────────

async function queryLeads(ctx: AgentContext, input: ToolInput) {
  const result = await leads.listLeads(ctx.db, actorOf(ctx), {
    search: input.search as string | undefined,
    status: input.status as string | undefined,
    nextContact: input.nextContact as string | undefined,
    mine: input.mine as boolean | undefined,
    pageSize: Math.min(50, Number(input.pageSize ?? 10)),
  })
  // 只返回模型需要的字段，节省上下文
  return {
    total: result.total,
    leads: result.data.map((l) => ({
      id: l.id, leadNo: l.leadNo, name: l.name, contactInfo: l.contactInfo, status: l.status, source: l.source,
      nextContactDate: l.nextContactDate, intendedServices: l.intendedServices, assignedToName: l.assignedToName,
    })),
  }
}

// ─── 线索详情 ─────────────────────────────────────────────────────────────────

async function getLead(ctx: AgentContext, input: ToolInput) {
  const id = input.id as string
  const lead = await leads.getLead(ctx.db, actorOf(ctx), id)

  const actRows = await ctx.db.prepare(`
    SELECT sa.activity_type, sa.description, sa.activity_date, sa.next_contact_date, u.name as user_name
    FROM sales_activities sa LEFT JOIN users u ON sa.user_id = u.id
    WHERE sa.lead_id = ? ORDER BY sa.activity_date DESC, sa.created_at DESC LIMIT 10
  `).bind(id).all<Record<string, unknown>>()

  return { ...lead, recentActivities: toCamelList(actRows.results) }
}

// ─── 查询客户 ─────────────────────────────────────────────────────────────────

async function queryClients(ctx: AgentContext, input: ToolInput) {
  const { db, userId, role } = ctx
  const search         = input.search as string | undefined
  const contractStatus = input.contractStatus as string | undefined
  const nextContact    = input.nextContact as string | undefined
  const pageSize       = Math.min(50, Number(input.pageSize ?? 10))
  const now            = new Date().toISOString().slice(0, 10)

  let where = 'WHERE c.deleted_at IS NULL'
  const params: unknown[] = []

  if (role === 'sales') { where += ' AND c.assigned_sales_userId = ?'; params.push(userId) }
  if (search) {
    where += ' AND (c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)'
    const q = `%${search}%`
    params.push(q, q, q)
  }
  if (contractStatus) { where += ' AND c.contract_status = ?'; params.push(contractStatus) }
  if (nextContact === 'overdue') { where += ' AND c.next_contact_date IS NOT NULL AND c.next_contact_date < ?'; params.push(now) }
  else if (nextContact === 'today') { where += ' AND c.next_contact_date = ?'; params.push(now) }
  else if (nextContact === 'week') { where += ' AND c.next_contact_date >= ? AND c.next_contact_date <= date(?, "+7 days")'; params.push(now, now) }

  const SELECT = 'SELECT c.id, c.name, c.phone, c.email, c.contract_status, c.service_plans, c.next_contact_date, u.name as assigned_sales_name FROM clients c LEFT JOIN users u ON c.assigned_sales_userId = u.id'
  const [rows, countRow] = await Promise.all([
    db.prepare(`${SELECT} ${where} ORDER BY c.created_at DESC LIMIT ?`).bind(...params, pageSize).all<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) as total FROM clients c ${where}`).bind(...params).first<{ total: number }>(),
  ])

  return {
    total: countRow?.total ?? 0,
    clients: toCamelList(rows.results).map((c) => ({
      ...c,
      servicePlans: (() => { try { return JSON.parse(c.servicePlans as string) } catch { return [] } })(),
    })),
  }
}

// ─── 客户详情 ─────────────────────────────────────────────────────────────────

async function getClient(ctx: AgentContext, input: ToolInput) {
  const { db, userId, role } = ctx
  const id = input.id as string

  const row = await db.prepare(`
    SELECT c.*, u.name as assigned_sales_name
    FROM clients c LEFT JOIN users u ON c.assigned_sales_userId = u.id
    WHERE c.id = ? AND c.deleted_at IS NULL
  `).bind(id).first<Record<string, unknown>>()
  if (!row) return { error: '客户不存在' }
  if (role === 'sales' && row.assigned_sales_userId !== userId) return { error: '无权访问此客户' }

  const client = toCamel(row) as Record<string, unknown>
  if (typeof client.servicePlans === 'string') {
    try { client.servicePlans = JSON.parse(client.servicePlans as string) } catch { client.servicePlans = [] }
  }

  const actRows = await db.prepare(`
    SELECT sa.activity_type, sa.description, sa.activity_date, sa.next_contact_date, u.name as user_name
    FROM sales_activities sa LEFT JOIN users u ON sa.user_id = u.id
    WHERE sa.client_id = ? ORDER BY sa.activity_date DESC, sa.created_at DESC LIMIT 10
  `).bind(id).all<Record<string, unknown>>()

  return { ...client, recentActivities: toCamelList(actRows.results) }
}

// ─── 创建跟进记录 ─────────────────────────────────────────────────────────────

async function createActivity(ctx: AgentContext, input: ToolInput) {
  const { db, userId } = ctx
  const entityType      = input.entityType as 'lead' | 'client'
  const entityId        = input.entityId as string
  const activityType    = input.activityType as string
  const description     = input.description as string
  const nextContactDate = (input.nextContactDate as string | undefined) ?? null

  // 校验 activityType 合法性
  const validType = await db.prepare(
    "SELECT id FROM option_items WHERE group_key = 'activity_type' AND value = ? AND is_active = 1",
  ).bind(activityType).first()
  if (!validType) return { error: `无效的跟进类型：${activityType}，请先调用 get_options(activity_type) 获取有效值` }

  const id = uuidv4()
  const today = new Date().toISOString().replace('T', ' ').slice(0, 19)

  await db.prepare(
    `INSERT INTO sales_activities (id, ${entityType === 'lead' ? 'lead_id' : 'client_id'}, user_id, activity_type, description, activity_date, next_contact_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, entityId, userId, activityType, description, today, nextContactDate).run()

  if (nextContactDate) {
    if (entityType === 'client') {
      await db.prepare('UPDATE clients SET next_contact_date = ? WHERE id = ?').bind(nextContactDate, entityId).run()
    } else {
      await db.prepare('UPDATE leads SET next_contact_date = ? WHERE id = ?').bind(nextContactDate, entityId).run()
    }
  }

  return { success: true, activityId: id, message: '跟进记录已创建' }
}

// ─── 更新线索（与界面相同的校验和附带处理） ─────────────────────────────────

async function updateLead(ctx: AgentContext, input: ToolInput) {
  const patch: leads.UpdateLeadPatch = {}
  if (input.status !== undefined) patch.status = input.status as string
  if (input.notes !== undefined) patch.notes = input.notes as string | null
  if (input.assignedToUserId !== undefined) patch.assignedToUserId = input.assignedToUserId as string | null
  if (input.nextContactDate !== undefined) patch.nextContactDate = input.nextContactDate as string | null
  if (input.intendedServices !== undefined) patch.intendedServices = input.intendedServices as string[]
  if (Object.keys(patch).length === 0) return { error: '未提供任何要更新的字段' }

  await leads.updateLead(depsOf(ctx), actorOf(ctx), input.id as string, patch)
  return { success: true, message: '线索已更新' }
}

// ─── 更新客户 ─────────────────────────────────────────────────────────────────

async function updateClient(ctx: AgentContext, input: ToolInput) {
  const { db, userId, role } = ctx
  const id = input.id as string

  const client = await db.prepare('SELECT assigned_sales_userId FROM clients WHERE id = ? AND deleted_at IS NULL').bind(id).first<{ assigned_sales_userId: string | null }>()
  if (!client) return { error: '客户不存在' }
  if (role === 'sales' && client.assigned_sales_userId !== userId) return { error: '无权操作此客户' }

  const updates: string[] = ['updated_at = CURRENT_TIMESTAMP']
  const params: unknown[] = []

  if (input.contractStatus !== undefined) { updates.push('contract_status = ?'); params.push(input.contractStatus) }
  if (input.phone !== undefined)          { updates.push('phone = ?');           params.push(input.phone) }
  if (input.email !== undefined)          { updates.push('email = ?');           params.push(input.email) }
  if (input.nextContactDate !== undefined){ updates.push('next_contact_date = ?'); params.push(input.nextContactDate) }
  if (input.servicePlans !== undefined) {
    updates.push('service_plans = ?')
    updates.push('service_plan = ?')
    const plans = input.servicePlans as string[]
    params.push(JSON.stringify(plans))
    params.push(plans[0] ?? null)
  }

  if (updates.length === 1) return { error: '未提供任何要更新的字段' }

  params.push(id)
  await db.prepare(`UPDATE clients SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run()
  return { success: true, message: '客户已更新' }
}

// ─── 获取枚举选项 ─────────────────────────────────────────────────────────────

async function getOptions(ctx: AgentContext, input: ToolInput) {
  const groupKey = input.groupKey as string
  const rows = await ctx.db.prepare(
    'SELECT value, label FROM option_items WHERE group_key = ? AND is_active = 1 ORDER BY sort_order ASC',
  ).bind(groupKey).all<{ value: string; label: string }>()
  return { groupKey, options: rows.results }
}

// ─── 查询用户 ─────────────────────────────────────────────────────────────────

async function queryUsers(ctx: AgentContext, input: ToolInput) {
  const role = input.role as string | undefined
  let sql = 'SELECT id, name, role FROM users WHERE is_active = 1'
  const params: unknown[] = []
  if (role) { sql += ' AND role = ?'; params.push(role) }
  sql += ' ORDER BY name ASC'
  const rows = await ctx.db.prepare(sql).bind(...params).all<{ id: string; name: string; role: string }>()
  return { users: rows.results }
}
