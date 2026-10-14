// 测试辅助：造数据、签发登录令牌、以指定身份调用接口
import { env, exports } from 'cloudflare:workers'
import { signCrmJwt } from '../src/shared/jwt'

export type Role = 'admin' | 'operations' | 'sales'
export interface TestUser { id: string; role: Role; teamId: string | null; token: string }

let seq = 0
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${++seq}`

export async function createTeam(): Promise<string> {
  const id = uid('team')
  await env.DB.prepare('INSERT INTO teams (id, name) VALUES (?, ?)').bind(id, id).run()
  return id
}

export async function createUser(role: Role, teamId: string | null = null, currentLeads = 0): Promise<TestUser> {
  const id = uid('user')
  await env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, name, role, team_id, current_leads_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(id, `${id}@test.local`, 'x', id, role, teamId, currentLeads).run()
  const token = await signCrmJwt({ userId: id, role, teamId }, env.JWT_SECRET)
  return { id, role, teamId, token }
}

export async function insertLead(fields: {
  status?: string; assignedTo?: string | null; teamId?: string | null; createdBy: string; name?: string
}): Promise<string> {
  const id = uid('lead')
  await env.DB.prepare(
    `INSERT INTO leads (id, source, name, contact_info, intended_services, status, created_by_userId,
       assigned_to_userId, assigned_to_teamId, lead_no)
     VALUES (?, 'test', ?, '13800000000', '["其他"]', ?, ?, ?, ?, (SELECT COALESCE(MAX(lead_no), 0) + 1 FROM leads))`,
  ).bind(id, fields.name ?? id, fields.status ?? 'New', fields.createdBy, fields.assignedTo ?? null, fields.teamId ?? null).run()
  return id
}

export async function api(user: TestUser | null, method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (user) headers.Authorization = `Bearer ${user.token}`
  return exports.default.fetch(`http://crm.test${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export async function leadsCount(userId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT current_leads_count AS n FROM users WHERE id = ?').bind(userId).first<{ n: number }>()
  return row?.n ?? -1
}

export async function systemActivities(leadId: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    "SELECT description FROM sales_activities WHERE lead_id = ? AND activity_type = 'System' ORDER BY created_at",
  ).bind(leadId).all<{ description: string }>()
  return rows.results.map((r) => r.description)
}

export async function leadRow(id: string) {
  return env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<Record<string, unknown>>()
}

export async function insertClient(fields: { assignedTo?: string | null; createdBy: string; name?: string; contractStatus?: string | null }): Promise<string> {
  const id = uid('client')
  await env.DB.prepare(
    `INSERT INTO clients (id, name, assigned_sales_userId, created_by_userId, contract_status, service_plans)
     VALUES (?, ?, ?, ?, ?, '[]')`,
  ).bind(id, fields.name ?? id, fields.assignedTo ?? null, fields.createdBy, fields.contractStatus ?? null).run()
  return id
}

export async function clientRow(id: string) {
  return env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first<Record<string, unknown>>()
}

export async function clientSystemActivities(clientId: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    "SELECT description FROM sales_activities WHERE client_id = ? AND activity_type = 'System' ORDER BY created_at",
  ).bind(clientId).all<{ description: string }>()
  return rows.results.map((r) => r.description)
}

export function agentCtx(user: TestUser) {
  const pending: Promise<unknown>[] = []
  return {
    ctx: { db: env.DB, env, userId: user.id, role: user.role, teamId: user.teamId, waitUntil: (p: Promise<unknown>) => { pending.push(p) } },
    settle: () => Promise.allSettled(pending),
  }
}
