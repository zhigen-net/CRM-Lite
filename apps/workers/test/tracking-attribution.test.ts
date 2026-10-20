// 访客 → 线索 → 客户：留资关联访客、先留资后有访客数据时补关联、线索 / 客户详情的来源与轨迹、权限
import { env, exports } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { invokeCapability } from '../src/domain/capabilities'
import { api, createTeam, createUser, type TestUser } from './helpers'

const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'
let admin: TestUser, ops: TestUser, sales: TestUser
let siteKey: string, apiKey: string

const uuid = () => crypto.randomUUID()
const collect = (payload: unknown) => exports.default.fetch('http://crm.test/api/t/collect', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'X-Site-Key': siteKey }, body: JSON.stringify(payload),
})
const pageview = (v: string, q: Record<string, string> = {}) => collect({
  v, s: uuid(), e: [{ id: uuid(), t: 'pageview', p: '/landing', h: 'site.test', r: 'https://www.baidu.com/', q }],
})
const pushLead = (body: Record<string, unknown>) => exports.default.fetch('http://crm.test/api/v1/leads', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
  body: JSON.stringify({ source: '官网表单', name: '访客转线索', contactInfo: `139${Date.now() % 1e8}`, intendedServices: ['其他'], ...body }),
})
const leadIdOf = async (res: Response) => ((await res.json()) as { data: { id: string } }).data.id
const visitorLead = (v: string) => env.DB.prepare('SELECT lead_id FROM visitors WHERE id = ?').bind(v).first<{ lead_id: string | null }>()

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  for (let i = 0; i < 50; i++) {
    const v = await fn()
    if (ok(v)) return v
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('等待后台写入超时')
}

beforeAll(async () => {
  admin = await createUser('admin')
  ops = await createUser('operations')
  sales = await createUser('sales', await createTeam())
  siteKey = ((await (await api(admin, 'POST', '/api/admin/tracking-sites', { name: '关联测试站' })).json()) as { data: { key: string } }).data.key
  apiKey = `crm_attr_${Date.now()}`
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('')
  await env.DB.prepare('INSERT INTO api_keys (id, user_id, key_hash, key_prefix) VALUES (?, ?, ?, ?)')
    .bind(`ak-attr-${Date.now()}`, ops.id, hash, apiKey.slice(0, 12)).run()
})

describe('留资关联访客', () => {
  it('表单带 crm_vid：线索记下访客，访客标为已留资；crm_vid 不进备注', async () => {
    const v = uuid()
    expect((await pageview(v, { utm_source: 'baidu', utm_medium: 'cpc', utm_campaign: '品牌词' })).status).toBe(204)
    await waitFor(() => visitorLead(v), (r) => r !== null)

    const res = await pushLead({ crm_vid: v.toUpperCase() })
    expect(res.status).toBe(201)
    const leadId = await leadIdOf(res)
    const lead = await env.DB.prepare('SELECT visitor_id, notes FROM leads WHERE id = ?').bind(leadId).first<{ visitor_id: string; notes: string | null }>()
    expect(lead?.visitor_id).toBe(v)
    expect(lead?.notes ?? '').not.toContain('crm_vid')
    expect((await visitorLead(v))?.lead_id).toBe(leadId)

    // 同一访客再次留资：新线索也记下访客，访客上保留第一条
    const second = await leadIdOf(await pushLead({ crm_vid: v }))
    expect((await env.DB.prepare('SELECT visitor_id FROM leads WHERE id = ?').bind(second).first<{ visitor_id: string }>())?.visitor_id).toBe(v)
    expect((await visitorLead(v))?.lead_id).toBe(leadId)
  })

  it('先留资、后收到访客数据：采集时补关联', async () => {
    const v = uuid()
    const leadId = await leadIdOf(await pushLead({ crm_vid: v }))
    expect(await visitorLead(v)).toBeNull()
    await pageview(v)
    const row = await waitFor(() => visitorLead(v), (r) => !!r?.lead_id)
    expect(row?.lead_id).toBe(leadId)
  })

  it('非法的访客 ID 忽略', async () => {
    const leadId = await leadIdOf(await pushLead({ crm_vid: "x' OR 1=1 --" }))
    expect((await env.DB.prepare('SELECT visitor_id FROM leads WHERE id = ?').bind(leadId).first<{ visitor_id: string | null }>())?.visitor_id).toBeNull()
  })
})

describe('线索 / 客户详情的来源与轨迹', () => {
  let v: string, leadId: string, clientId: string

  beforeAll(async () => {
    v = uuid()
    await pageview(v, { bd_vid: 'click-1', utm_campaign: '活动A' })
    await waitFor(() => visitorLead(v), (r) => r !== null)
    leadId = await leadIdOf(await pushLead({ crm_vid: v }))
  })

  it('线索：返回站点、首次来源和访问轨迹；没有关联访客时为 null', async () => {
    const res = await api(ops, 'GET', `/api/leads/${leadId}/attribution`)
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: { siteName: string; visitor: Record<string, unknown>; visits: { events: unknown[] }[] } }
    expect(data.siteName).toBe('关联测试站')
    expect(data.visitor).toMatchObject({ firstChannel: 'paid', firstClickIdType: 'bd_vid', firstUtmCampaign: '活动A', leadId })
    expect(data.visits[0]?.events.length).toBeGreaterThan(0)

    const plain = await leadIdOf(await pushLead({}))
    expect(((await (await api(ops, 'GET', `/api/leads/${plain}/attribution`)).json()) as { data: unknown }).data).toBeNull()
  })

  it('可见范围跟随线索：看不到线索的销售也看不到来源', async () => {
    expect((await api(sales, 'GET', `/api/leads/${leadId}/attribution`)).status).toBeGreaterThanOrEqual(403)
  })

  it('转化为客户后，客户详情显示同一来源', async () => {
    const res = await api(admin, 'POST', '/api/clients', { leadId, name: '访客转客户' })
    expect(res.status).toBe(201)
    clientId = ((await res.json()) as { data: { id: string } }).data.id
    const { data } = (await (await api(admin, 'GET', `/api/clients/${clientId}/attribution`)).json()) as { data: { visitor: Record<string, unknown> } }
    expect(data.visitor).toMatchObject({ id: v, firstChannel: 'paid' })
  })

  it('AI 能力 get_lead / get_client 带精简来源', async () => {
    const deps = { db: env.DB, env, waitUntil: () => {} }
    const actor = { userId: admin.id, role: admin.role, teamId: null, via: 'mcp' as const, apiKeyId: 'ak-x' }
    const lead = (await invokeCapability(deps, actor, 'get_lead', { id: leadId }, ['leads:read'])) as { visitorSource: Record<string, unknown> }
    expect(lead.visitorSource).toMatchObject({ site: '关联测试站', channel: 'paid', clickIdType: 'bd_vid', utmCampaign: '活动A', visits: 1 })
    const client = (await invokeCapability(deps, actor, 'get_client', { id: clientId }, ['clients:read'])) as { visitorSource: Record<string, unknown> }
    expect(client.visitorSource).toMatchObject({ channel: 'paid' })
  })
})

describe('访客 IP 的可见范围', () => {
  let leadId: string
  const ownSales = { u: null as TestUser | null }

  beforeAll(async () => {
    const v = uuid()
    await exports.default.fetch('http://crm.test/api/t/collect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'User-Agent': UA, 'X-Site-Key': siteKey,
        'X-Visitor-Geo': encodeURIComponent(JSON.stringify({ ip: '198.51.100.23', city: '杭州' })),
      },
      body: JSON.stringify({ v, s: uuid(), e: [{ id: uuid(), t: 'pageview', p: '/', h: 'site.test' }] }),
    })
    await waitFor(() => visitorLead(v), (r) => r !== null)
    leadId = await leadIdOf(await pushLead({ crm_vid: v }))
    // 把线索分给一位销售，让他能看到这条线索
    ownSales.u = await createUser('sales', await createTeam())
    await env.DB.prepare('UPDATE leads SET assigned_to_userId = ? WHERE id = ?').bind(ownSales.u.id, leadId).run()
  })

  it('运营看得到完整 IP；负责的销售能看来源但看不到 IP', async () => {
    const opsData = ((await (await api(ops, 'GET', `/api/leads/${leadId}/attribution`)).json()) as { data: { visitor: Record<string, unknown>; visits: Record<string, unknown>[] } }).data
    expect(opsData.visitor.lastIp).toBe('198.51.100.23')
    expect(opsData.visits[0]?.ip).toBe('198.51.100.23')

    const res = await api(ownSales.u!, 'GET', `/api/leads/${leadId}/attribution`)
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('杭州')
    expect(text).not.toContain('198.51.100.23')
  })

  it('MCP 没有 contacts:read 时 IP 打码；销售通过 AI 读取也没有 IP', async () => {
    const deps = { db: env.DB, env, waitUntil: () => {} }
    const mcp = { userId: admin.id, role: admin.role, teamId: null, via: 'mcp' as const, apiKeyId: 'ak-ip' }
    const masked = (await invokeCapability(deps, mcp, 'get_lead', { id: leadId }, ['leads:read'])) as { visitorSource: { ip: string } }
    expect(masked.visitorSource.ip).toBe('198.51.*.*')
    const full = (await invokeCapability(deps, mcp, 'get_lead', { id: leadId }, ['leads:read', 'contacts:read'])) as { visitorSource: { ip: string } }
    expect(full.visitorSource.ip).toBe('198.51.100.23')
    const s = ownSales.u!
    const salesView = (await invokeCapability(deps, { userId: s.id, role: 'sales', teamId: s.teamId, via: 'assistant' as const }, 'get_lead', { id: leadId })) as { visitorSource: Record<string, unknown> }
    expect(salesView.visitorSource).not.toHaveProperty('ip')
  })
})
