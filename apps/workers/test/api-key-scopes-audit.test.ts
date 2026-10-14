// API Key 权限范围与审计日志
import { env, exports } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { executeTool } from '../src/crm/agent/executor'
import { invokeCapability } from '../src/domain/capabilities'
import { agentCtx, api, createUser, insertLead, type TestUser } from './helpers'

let admin: TestUser, sales: TestUser

type AuditRow = { action: string; via: string; status: string; target_id: string | null; api_key_id: string | null; user_id: string }

/** 审计在后台写入，轮询等待 */
async function auditRows(where: string, ...params: unknown[]): Promise<AuditRow[]> {
  for (let i = 0; i < 20; i++) {
    const rows = await env.DB.prepare(`SELECT * FROM audit_log WHERE ${where}`).bind(...params).all<AuditRow>()
    if (rows.results.length > 0) return rows.results
    await new Promise((r) => setTimeout(r, 25))
  }
  return []
}

async function createKey(user: TestUser, body: Record<string, unknown>) {
  const res = await api(user, 'POST', '/api/auth/api-keys', body)
  return { status: res.status, data: ((await res.json()) as { data: { id: string; key: string; scopes: string[] } }).data }
}

const postLead = (key: string, name: string) => exports.default.fetch('http://crm.test/api/v1/leads', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
  body: JSON.stringify({ source: '审计测试', name, contactInfo: '13500000000', intendedServices: ['其他'] }),
})

beforeAll(async () => {
  admin = await createUser('admin')
  sales = await createUser('sales')
})

describe('API Key scopes', () => {
  it('不指定时只授予 leads:create；可指定其它 scope；非法 scope 拒绝', async () => {
    expect((await createKey(sales, { name: 'default' })).data.scopes).toEqual(['leads:create'])
    expect((await createKey(sales, { name: 'ro', scopes: ['leads:read', 'meta:read'] })).data.scopes).toEqual(['leads:read', 'meta:read'])
    expect((await createKey(sales, { name: 'bad', scopes: ['admin:all'] })).status).toBe(400)
    expect((await createKey(sales, { name: 'empty', scopes: [] })).status).toBe(400)

    const list = await (await api(sales, 'GET', '/api/auth/api-keys')).json() as { data: { name: string; scopes: string[] }[] }
    expect(list.data.find((k) => k.name === 'ro')?.scopes).toEqual(['leads:read', 'meta:read'])
  })

  it('没有 leads:create 的密钥不能推送线索', async () => {
    const { data } = await createKey(admin, { name: 'read-only', scopes: ['leads:read'] })
    expect((await postLead(data.key, '无权推送')).status).toBe(403)
  })
})

describe('审计日志', () => {
  it('对外接口新建线索：记录密钥、用户和线索 ID', async () => {
    const { data } = await createKey(admin, { name: 'push' })
    const res = await postLead(data.key, '审计-推送')
    expect(res.status).toBe(201)
    const { id } = ((await res.json()) as { data: { id: string } }).data
    const rows = await auditRows('target_id = ?', id)
    expect(rows[0]).toMatchObject({ action: 'create_lead', via: 'api', status: 'ok', api_key_id: data.id, user_id: admin.id })
  })

  it('AI 助手：写操作记录，读操作不记录', async () => {
    const id = await insertLead({ createdBy: admin.id, assignedTo: admin.id })
    const { ctx, settle } = agentCtx(admin)
    await executeTool(ctx as never, 'get_lead', { id })
    await executeTool(ctx as never, 'update_lead', { id, nextContactDate: '2030-01-01' })
    await executeTool(ctx as never, 'update_lead', { id, status: 'Bogus' })
    await settle()
    const rows = await env.DB.prepare('SELECT action, via, status FROM audit_log WHERE target_id = ? ORDER BY created_at')
      .bind(id).all<{ action: string; via: string; status: string }>()
    expect(rows.results.map((r) => `${r.action}:${r.status}`).sort()).toEqual(['update_lead:error', 'update_lead:ok'])
    expect(rows.results.every((r) => r.via === 'assistant')).toBe(true)
  })

  it('通过 API Key 读取数据也记录', async () => {
    const id = await insertLead({ createdBy: admin.id })
    const pending: Promise<unknown>[] = []
    const deps = { db: env.DB, env, waitUntil: (p: Promise<unknown>) => { pending.push(p) } }
    const actor = { userId: admin.id, role: admin.role, teamId: null, via: 'api' as const, apiKeyId: 'ak-read' }
    await invokeCapability(deps, actor, 'get_lead', { id }, ['leads:read'])
    await Promise.all(pending)
    const rows = await auditRows('target_id = ? AND action = ?', id, 'get_lead')
    expect(rows[0]).toMatchObject({ via: 'api', api_key_id: 'ak-read', status: 'ok' })
  })

  it('只有管理员能查看审计日志', async () => {
    const res = await api(admin, 'GET', '/api/admin/audit-log?via=assistant&pageSize=5')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { via: string; userName: string }[]; total: number }
    expect(body.total).toBeGreaterThan(0)
    expect(body.data.every((r) => r.via === 'assistant')).toBe(true)
    expect((await api(sales, 'GET', '/api/admin/audit-log')).status).toBe(403)
  })
})
