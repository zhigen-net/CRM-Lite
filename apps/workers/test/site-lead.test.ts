// 网站表单留资 /api/t/lead：与 /api/v1/leads 共用同一套处理，两边写入的线索一致；网站入口特有的防刷与响应格式
import { env, exports } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { api, createUser, type TestUser } from './helpers'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
let admin: TestUser, ops: TestUser
let siteId: string, siteKey: string, apiKey: string

const uuid = () => crypto.randomUUID()
const geo = (ip: string) => encodeURIComponent(JSON.stringify({ ip, city: '杭州' }))

/** 模拟网站转发：带站点密钥和访客 IP */
function siteLead(body: string | Record<string, unknown>, opts: { type?: string; ip?: string; key?: string } = {}) {
  const type = opts.type ?? 'application/json'
  return exports.default.fetch('http://crm.test/api/t/lead', {
    method: 'POST',
    headers: { 'Content-Type': type, 'User-Agent': UA, 'X-Site-Key': opts.key ?? siteKey, 'X-Visitor-Geo': geo(opts.ip ?? `198.51.100.${Math.floor(Math.random() * 250)}`) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}
const v1Lead = (body: Record<string, unknown>) => exports.default.fetch('http://crm.test/api/v1/leads', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey }, body: JSON.stringify(body),
})
const leadRow = (where: string, ...params: unknown[]) =>
  env.DB.prepare(`SELECT * FROM leads WHERE ${where} ORDER BY created_at DESC LIMIT 1`).bind(...params).first<Record<string, unknown>>()

beforeAll(async () => {
  admin = await createUser('admin')
  ops = await createUser('operations')
  const site = ((await (await api(admin, 'POST', '/api/admin/tracking-sites', { name: '留资测试站' })).json()) as { data: { id: string; key: string } }).data
  siteId = site.id
  siteKey = site.key
  apiKey = `crm_site_lead_${Date.now()}`
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('')
  await env.DB.prepare('INSERT INTO api_keys (id, user_id, key_hash, key_prefix) VALUES (?, ?, ?, ?)')
    .bind(`ak-sl-${Date.now()}`, ops.id, hash, apiKey.slice(0, 12)).run()
})

describe('两个入口同一套处理', () => {
  it('同样的内容分别从 /api/t/lead 和 /api/v1/leads 提交，整理结果一致', async () => {
    const payload = { source: '官网表单', name: '一致性', phone: '13700000001', 留言: '想了解价格', intendedServices: ['火星旅行'], campaign: '计划X', extra: '附加' }
    expect((await siteLead({ ...payload, crm_vid: uuid() })).status).toBe(200)
    const a = await leadRow("contact_info = '13700000001'")
    expect((await v1Lead({ ...payload, phone: '13700000002' })).status).toBe(201)
    const b = await leadRow("contact_info = '13700000002'")
    for (const k of ['source', 'name', 'intended_services', 'notes', 'status'] as const) expect(a?.[k]).toEqual(b?.[k])
    expect(a?.notes).toContain('想了解价格')
    expect(a?.notes).toContain('extra：附加')
    expect(JSON.parse(String(a?.intended_services))).toEqual(['其他'])
    expect(JSON.parse(String(a?.ad_info))['广告计划']).toBe('计划X')
    expect(JSON.parse(String(b?.ad_info))['广告计划']).toBe('计划X')
  })

  it('对外接口也认识常见字段名（phone / 姓名）', async () => {
    expect((await v1Lead({ source: 'x', 姓名: '别名', phone: '13700000003' })).status).toBe(201)
    expect(await leadRow("contact_info = '13700000003'")).toMatchObject({ name: '别名' })
  })
})

describe('网站表单留资', () => {
  it('JSON 提交：来源默认用站点名称，记在站点创建人名下，带上访客 IP 并关联访客', async () => {
    const v = uuid()
    const res = await siteLead({ name: '网站留资', phone: '13700000010', crm_vid: v, _page: 'https://site.test/lp?utm_source=x' }, { ip: '203.0.113.50' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const lead = await leadRow("contact_info = '13700000010'")
    expect(lead).toMatchObject({ source: '留资测试站', created_by_userId: admin.id, visitor_id: v })
    expect(JSON.parse(String(lead?.ad_info))).toMatchObject({ ip: '203.0.113.50', url: 'https://site.test/lp?utm_source=x' })
    expect(String(lead?.notes ?? '')).not.toMatch(/_page|crm_vid/)
    const audit = await env.DB.prepare("SELECT via, status FROM audit_log WHERE target_id = ?").bind(lead?.id).first<{ via: string; status: string }>()
    expect(audit).toMatchObject({ via: 'site', status: 'ok' })
  })

  it('原生表单提交：返回提示页面，_redirect 只接受站内路径', async () => {
    const body = new URLSearchParams({ 姓名: '原生表单', 电话: '13700000011', _redirect: '/thanks', crm_vid: uuid() }).toString()
    const res = await siteLead(body, { type: 'application/x-www-form-urlencoded' })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('提交成功')
    expect(html).toContain('url=/thanks')
    expect(await leadRow("contact_info = '13700000011'")).toMatchObject({ name: '原生表单' })

    const evil = new URLSearchParams({ name: 'x', phone: '13700000012', _redirect: '//evil.example' }).toString()
    expect(await (await siteLead(evil, { type: 'application/x-www-form-urlencoded' })).text()).not.toContain('evil.example')
  })

  it('缺少联系方式：400 并说明原因；密钥错误 401', async () => {
    const res = await siteLead({ name: '没留电话' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { message: string }).message).toContain('联系方式')
    expect((await siteLead({ name: 'x', phone: '1' }, { key: 'cts_wrong' })).status).toBe(401)
  })

  it('蜜罐字段有值：返回成功但不建线索', async () => {
    const res = await siteLead({ name: '机器人', phone: '13700000020', _hp: 'http://spam' })
    expect(res.status).toBe(200)
    expect(await leadRow("contact_info = '13700000020'")).toBeNull()
  })

  it('同一访客 10 分钟内超过 3 次提交：429', async () => {
    const v = uuid()
    for (let i = 0; i < 3; i++) expect((await siteLead({ name: '频繁', phone: `1370000003${i}`, crm_vid: v })).status).toBe(200)
    expect((await siteLead({ name: '频繁', phone: '13700000039', crm_vid: v })).status).toBe(429)
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM site_lead_submissions WHERE site_id = ? AND visitor_id = ? AND status = 'rate_limited'")
      .bind(siteId, v).first<{ n: number }>()
    expect(n?.n).toBe(1)
  })

  it('采集脚本提供 submitLead，并给提交到 /_t/lead 的表单加蜜罐字段', async () => {
    const js = await (await exports.default.fetch('http://crm.test/api/t/t.js')).text()
    expect(js).toContain('submitLead: submitLead')
    expect(js).toContain("indexOf('/_t/lead')")
    expect(js).toContain("hp.name = '_hp'")
  })
})
