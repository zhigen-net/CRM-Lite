import { actorFromJwt, type Role } from '../../domain/actor'
import { DomainError } from '../../domain/errors'
import * as leads from '../../domain/leads/service'
import * as clients from '../../domain/clients/service'
import * as activities from '../../domain/activities/service'

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

  return { ...lead, recentActivities: await activities.recentActivities(ctx.db, 'lead', id) }
}

// ─── 查询客户（可见范围与界面一致，由 domain/clients 决定） ─────────────────────

async function queryClients(ctx: AgentContext, input: ToolInput) {
  const result = await clients.listClients(ctx.db, actorOf(ctx), {
    search: input.search as string | undefined,
    contractStatus: input.contractStatus as string | undefined,
    nextContact: input.nextContact as string | undefined,
    pageSize: Math.min(50, Number(input.pageSize ?? 10)),
  })
  // 只返回模型需要的字段，节省上下文
  return {
    total: result.total,
    clients: result.data.map((c) => ({
      id: c.id, name: c.name, phone: c.phone, email: c.email, contractStatus: c.contractStatus,
      servicePlans: c.servicePlans, nextContactDate: c.nextContactDate, assignedSalesName: c.assignedSalesName,
    })),
  }
}

// ─── 客户详情 ─────────────────────────────────────────────────────────────────

async function getClient(ctx: AgentContext, input: ToolInput) {
  const id = input.id as string
  const client = await clients.getClient(ctx.db, actorOf(ctx), id)
  return { ...client, recentActivities: await activities.recentActivities(ctx.db, 'client', id) }
}

// ─── 创建跟进记录（与界面相同的权限、校验和附带处理） ─────────────────────────

async function createActivity(ctx: AgentContext, input: ToolInput) {
  const entityType = input.entityType as 'lead' | 'client'
  const entityId = input.entityId as string
  const id = await activities.createActivity(depsOf(ctx), actorOf(ctx), {
    leadId: entityType === 'lead' ? entityId : null,
    clientId: entityType === 'client' ? entityId : null,
    activityType: input.activityType as string,
    description: (input.description as string | undefined) ?? null,
    activityDate: new Date().toISOString().replace('T', ' ').slice(0, 19),
    nextContactDate: (input.nextContactDate as string | undefined) ?? null,
  })
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

// ─── 更新客户（与界面相同的权限、变更记录和工作流） ───────────────────────────

async function updateClient(ctx: AgentContext, input: ToolInput) {
  const patch: clients.UpdateClientPatch = {}
  if (input.contractStatus !== undefined) patch.contractStatus = input.contractStatus as string | null
  if (input.phone !== undefined) patch.phone = input.phone as string | null
  if (input.email !== undefined) patch.email = input.email as string | null
  if (input.nextContactDate !== undefined) patch.nextContactDate = input.nextContactDate as string | null
  if (input.servicePlans !== undefined) patch.servicePlans = input.servicePlans as string[]
  if (Object.keys(patch).length === 0) return { error: '未提供任何要更新的字段' }

  await clients.updateClient(depsOf(ctx), actorOf(ctx), input.id as string, patch)
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
