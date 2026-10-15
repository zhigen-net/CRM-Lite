// MCP 服务：协议握手、按 scope 过滤工具、权限与可见范围、联系方式打码、审计
import { env, exports } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { clientRow, createTeam, createUser, insertClient, insertLead, leadRow, leadsCount, systemActivities, type TestUser } from './helpers'

let admin: TestUser, salesA: TestUser, salesB: TestUser, teamId: string
const keys: Record<string, string> = {}

async function makeKey(user: TestUser, scopes: string[]): Promise<string> {
  const key = `crm_mcp_${crypto.randomUUID().replace(/-/g, '')}`
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('')
  await env.DB.prepare('INSERT INTO api_keys (id, user_id, key_hash, key_prefix, scopes) VALUES (?, ?, ?, ?, ?)')
    .bind(`ak-${crypto.randomUUID()}`, user.id, hash, key.slice(0, 12), JSON.stringify(scopes)).run()
  return key
}

const READ = ['leads:read', 'clients:read', 'activities:read', 'meta:read']
const WRITE = [...READ, 'leads:create', 'leads:write', 'clients:write', 'activities:write']

function mcp(key: string | null, body: unknown, headers: Record<string, string> = {}) {
  return exports.default.fetch('http://crm.test/api/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(key ? { 'X-API-Key': key } : {}), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

let seq = 0
async function call(key: string, method: string, params?: unknown) {
  const res = await mcp(key, { jsonrpc: '2.0', id: ++seq, method, params })
  expect(res.status).toBe(200)
  return (await res.json()) as { result?: Record<string, unknown> & { tools?: { name: string; annotations: { readOnlyHint: boolean } }[] }; error?: { code: number } }
}
async function tool(key: string, name: string, args: Record<string, unknown> = {}) {
  const out = await call(key, 'tools/call', { name, arguments: args })
  const r = out.result as { isError?: boolean; content: { text: string }[]; structuredContent?: Record<string, unknown> }
  return { isError: !!r.isError, text: r.content[0]?.text ?? '', data: r.structuredContent }
}

beforeAll(async () => {
  const team = await createTeam()
  teamId = team
  admin = await createUser('admin')
  salesA = await createUser('sales', team)
  salesB = await createUser('sales', team)
  keys.adminRead = await makeKey(admin, READ)
  keys.adminWrite = await makeKey(admin, WRITE)
  keys.adminContacts = await makeKey(admin, [...READ, 'contacts:read'])
  keys.salesA = await makeKey(salesA, WRITE)
  keys.push = await makeKey(admin, ['leads:create'])
})

describe('协议', () => {
  it('没有密钥 401；GET 405', async () => {
    expect((await mcp(null, { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(401)
    expect((await exports.default.fetch('http://crm.test/api/mcp', { headers: { 'X-API-Key': keys.adminRead! } })).status).toBe(405)
  })

  it('initialize 回应客户端的协议版本；不支持的版本回落到最新', async () => {
    const r1 = await call(keys.adminRead!, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } })
    expect(r1.result).toMatchObject({ protocolVersion: '2025-03-26', serverInfo: { name: 'crm' }, capabilities: { tools: {} } })
    const r2 = await call(keys.adminRead!, 'initialize', { protocolVersion: '1999-01-01' })
    expect(r2.result?.protocolVersion).toBe('2025-06-18')
  })

  it('只有通知时返回 202；批量请求返回数组；未知方法 -32601；坏 JSON -32700', async () => {
    expect((await mcp(keys.adminRead!, { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)
    const batch = await mcp(keys.adminRead!, [
      { jsonrpc: '2.0', id: 'a', method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 'b', method: 'resources/list' },
    ])
    const arr = (await batch.json()) as { id: string; result?: unknown; error?: { code: number } }[]
    expect(arr.map((r) => r.id)).toEqual(['a', 'b'])
    expect(arr[1]?.error?.code).toBe(-32601)
    const bad = await mcp(keys.adminRead!, '{not json')
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as { error: { code: number } }).error.code).toBe(-32700)
  })

  it('支持 Authorization: Bearer', async () => {
    const res = await mcp(null, { jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: `Bearer ${keys.adminRead}` })
    expect(res.status).toBe(200)
  })
})

describe('工具与权限', () => {
  it('tools/list 按 scope 过滤，并带只读标记', async () => {
    const read = (await call(keys.adminRead!, 'tools/list')).result!.tools!
    const names = read.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['query_leads', 'get_lead', 'list_activities', 'whoami', 'get_options']))
    expect(names).not.toContain('update_lead')
    expect(names).not.toContain('create_lead')
    expect(read.every((t) => t.annotations.readOnlyHint)).toBe(true)

    const push = (await call(keys.push!, 'tools/list')).result!.tools!.map((t) => t.name)
    expect(push.sort()).toEqual(['create_lead', 'whoami'])
  })

  it('越权调用返回工具错误，不写库', async () => {
    const id = await insertLead({ createdBy: admin.id })
    const out = await tool(keys.adminRead!, 'update_lead', { id, status: 'Lost' })
    expect(out.isError).toBe(true)
    expect((await leadRow(id))?.status).toBe('New')
  })

  it('whoami 返回身份和 scopes', async () => {
    const out = await tool(keys.salesA!, 'whoami')
    expect(out.data).toMatchObject({ userId: salesA.id, role: 'sales', via: 'mcp' })
    expect(out.data?.scopes).toEqual(WRITE)
  })

  it('销售只能看到自己的线索（与界面一致）', async () => {
    const mine = await insertLead({ createdBy: salesA.id, assignedTo: salesA.id, name: 'mcp-vis-mine' })
    const others = await insertLead({ createdBy: salesB.id, assignedTo: salesB.id, name: 'mcp-vis-others' })
    const out = await tool(keys.salesA!, 'query_leads', { search: 'mcp-vis-', pageSize: 50 })
    const ids = (out.data?.leads as { id: string }[]).map((l) => l.id)
    expect(ids).toContain(mine)
    expect(ids).not.toContain(others)
    expect((await tool(keys.salesA!, 'get_lead', { id: others })).isError).toBe(true)
  })

  it('没有 contacts:read 时联系方式打码', async () => {
    const id = await insertLead({ createdBy: admin.id, name: 'mcp-mask' })
    const masked = await tool(keys.adminRead!, 'get_lead', { id })
    expect(masked.data?.contactInfo).toBe('138****0000')
    expect(masked.text).not.toContain('13800000000')
    const full = await tool(keys.adminContacts!, 'get_lead', { id })
    expect(full.data?.contactInfo).toBe('13800000000')
  })

  it('create_lead 走分配规则与工作流，记录审计（via=mcp）', async () => {
    const out = await tool(keys.adminWrite!, 'create_lead', { source: 'MCP', name: 'mcp-新建', contactInfo: '13700001111', intendedServices: ['火星旅行'] })
    expect(out.isError).toBe(false)
    const leadId = out.data?.leadId as string
    const row = await leadRow(leadId)
    expect(row?.intended_services).toBe('["其他"]')
    expect(String(row?.notes)).toContain('火星旅行')
    let audit: { via: string; action: string } | null = null
    for (let i = 0; i < 20 && !audit; i++) {
      audit = await env.DB.prepare('SELECT via, action FROM audit_log WHERE target_id = ?').bind(leadId).first()
      if (!audit) await new Promise((r) => setTimeout(r, 25))
    }
    expect(audit).toMatchObject({ via: 'mcp', action: 'create_lead' })
  })
})

describe('维护线索与客户（管理员、客服日常使用）', () => {
  it('update_lead 可改联系方式、来源、团队、丢失原因，并写变更记录', async () => {
    const id = await insertLead({ createdBy: admin.id })
    const out = await tool(keys.adminWrite!, 'update_lead', {
      id, contactInfo: '13811112222', source: '转介绍', assignedToTeamId: teamId, status: 'Lost', lostReason: '其他',
    })
    expect(out.isError).toBe(false)
    const row = await leadRow(id)
    expect(row).toMatchObject({ contact_info: '13811112222', source: '转介绍', assigned_to_teamId: teamId, status: 'Lost', lost_reason: '其他' })
    expect((await systemActivities(id)).length).toBeGreaterThan(0)
  })

  it('销售不能修改团队（与界面一致）', async () => {
    const id = await insertLead({ createdBy: salesA.id, assignedTo: salesA.id })
    expect((await tool(keys.salesA!, 'update_lead', { id, assignedToTeamId: teamId })).isError).toBe(true)
    expect((await leadRow(id))?.assigned_to_teamId).toBeNull()
  })

  it('update_client 可改姓名、负责销售；备注合并进资料，不丢失来源', async () => {
    const id = await insertClient({ createdBy: admin.id, name: 'mcp-客户' })
    await env.DB.prepare("UPDATE clients SET detailed_profile = ? WHERE id = ?").bind(JSON.stringify({ source: '官网', notes: '旧备注' }), id).run()
    const out = await tool(keys.adminWrite!, 'update_client', { id, name: 'mcp-客户-改', assignedSalesUserId: salesA.id, notes: '新备注' })
    expect(out.isError).toBe(false)
    const row = await clientRow(id)
    expect(row).toMatchObject({ name: 'mcp-客户-改', assigned_sales_userId: salesA.id })
    expect(JSON.parse(String(row?.detailed_profile))).toEqual({ source: '官网', notes: '新备注' })
  })

  it('convert_lead：线索转客户，默认带上姓名电话和负责人，计数 -1，不能重复转化', async () => {
    const before = await leadsCount(salesA.id)
    const id = await insertLead({ createdBy: salesA.id, assignedTo: salesA.id, name: 'mcp-转化' })
    await env.DB.prepare('UPDATE users SET current_leads_count = current_leads_count + 1 WHERE id = ?').bind(salesA.id).run()
    const out = await tool(keys.salesA!, 'convert_lead', { leadId: id })
    expect(out.isError).toBe(false)
    const clientId = out.data?.clientId as string
    expect(await clientRow(clientId)).toMatchObject({ name: 'mcp-转化', phone: '13800000000', assigned_sales_userId: salesA.id, lead_id: id })
    expect((await leadRow(id))?.status).toBe('Converted')
    expect(await leadsCount(salesA.id)).toBe(before)
    expect((await tool(keys.salesA!, 'convert_lead', { leadId: id })).isError).toBe(true)
  })

  it('销售不能转化别人的线索；只读密钥看不到维护工具', async () => {
    const others = await insertLead({ createdBy: salesB.id, assignedTo: salesB.id })
    expect((await tool(keys.salesA!, 'convert_lead', { leadId: others })).isError).toBe(true)
    const names = (await call(keys.adminRead!, 'tools/list')).result!.tools!.map((t) => t.name)
    expect(names).not.toContain('convert_lead')
    expect(names).toContain('query_teams')
  })

  it('query_teams 返回团队', async () => {
    const out = await tool(keys.adminRead!, 'query_teams')
    expect((out.data?.teams as { id: string }[]).map((t) => t.id)).toContain(teamId)
  })
})
