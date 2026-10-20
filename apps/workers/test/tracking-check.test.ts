// 接入检测：模拟网站的转发代码，覆盖配置正确、密钥错误、路由未生效、网站不可达等情况
import { env, exports } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { checkSiteIntegration, normalizeHost } from '../src/domain/tracking/check'
import { api, createUser, type TestUser } from './helpers'

let admin: TestUser, ops: TestUser
let site: { id: string; name: string; isActive: boolean }
let siteKey: string
let otherKey: string

const html = () => new Response('<!doctype html><html><body>index</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })

/** 模拟网站：/_t/* 按转发代码的方式带密钥转给 CRM */
function website(key: string | null, mode: 'proxy' | 'html' | 'missing' | 'down' = 'proxy'): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (mode === 'down') throw new TypeError('network error')
    const url = new URL(String(input))
    if (mode === 'html') return html()
    if (mode === 'missing') return new Response('not found', { status: init?.method === 'POST' ? 405 : 404 })
    const headers = new Headers({ 'Content-Type': 'application/json', 'User-Agent': 'x' })
    if (key) headers.set('X-Site-Key', key)
    return exports.default.fetch(`http://crm.test${url.pathname.replace(/^\/_t\//, '/api/t/')}`, { method: init?.method ?? 'GET', headers, body: init?.body ?? null })
  }) as typeof fetch
}

beforeAll(async () => {
  admin = await createUser('admin')
  ops = await createUser('operations')
  const make = async (name: string) =>
    ((await (await api(admin, 'POST', '/api/admin/tracking-sites', { name })).json()) as { data: { id: string; name: string; key: string } }).data
  const a = await make('检测站点')
  site = { id: a.id, name: a.name, isActive: true }
  siteKey = a.key
  otherKey = (await make('另一个站点')).key
})

describe('域名整理', () => {
  it('接受网址或域名，拒绝 IP、localhost 和空值', () => {
    expect(normalizeHost('https://WWW.Example.com/path?x=1')).toBe('www.example.com')
    expect(normalizeHost('landing.example.co.uk')).toBe('landing.example.co.uk')
    for (const bad of ['', 'localhost', '127.0.0.1', '10.0.0.1', 'http://[::1]/', 'exa mple.com']) {
      expect(() => normalizeHost(bad)).toThrow()
    }
  })
})

describe('接入检测', () => {
  it('探测请求只回报站点、不写入数据', async () => {
    const before = await env.DB.prepare('SELECT last_seen_at FROM tracking_sites WHERE id = ?').bind(site.id).first<{ last_seen_at: string | null }>()
    const res = await exports.default.fetch('http://crm.test/api/t/collect', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Site-Key': siteKey }, body: '{"ping":1}',
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as { data: { siteId: string } }).data.siteId).toBe(site.id)
    const after = await env.DB.prepare('SELECT last_seen_at FROM tracking_sites WHERE id = ?').bind(site.id).first<{ last_seen_at: string | null }>()
    expect(after?.last_seen_at).toBe(before?.last_seen_at)
  })

  it('配置正确：脚本和上报都通过', async () => {
    const r = await checkSiteIntegration(site, 'www.site.test', website(siteKey))
    expect(r.script).toMatchObject({ ok: true, reason: 'ok' })
    expect(r.collect).toMatchObject({ ok: true, reason: 'ok' })
    expect(r.lead).toMatchObject({ ok: true, reason: 'ok' })
  })

  it('密钥错误或缺失：bad_key；用了别的站点的密钥：wrong_site', async () => {
    expect((await checkSiteIntegration(site, 'www.site.test', website('cts_wrong'))).collect.reason).toBe('bad_key')
    expect((await checkSiteIntegration(site, 'www.site.test', website(null))).collect.reason).toBe('bad_key')
    expect((await checkSiteIntegration(site, 'www.site.test', website(otherKey))).collect.reason).toBe('wrong_site')
  })

  it('转发代码没生效：返回 HTML 或 404；网站不可达：unreachable', async () => {
    const h = await checkSiteIntegration(site, 'www.site.test', website(siteKey, 'html'))
    expect(h.script.reason).toBe('html')
    expect(h.collect.reason).toBe('html')
    const m = await checkSiteIntegration(site, 'www.site.test', website(siteKey, 'missing'))
    expect(m.script.reason).toBe('not_found')
    expect(m.collect.reason).toBe('not_found')
    expect((await checkSiteIntegration(site, 'www.site.test', website(siteKey, 'down'))).collect.reason).toBe('unreachable')
  })

  it('只有管理员可检测；域名不合法时 400', async () => {
    expect((await api(ops, 'POST', `/api/admin/tracking-sites/${site.id}/check`, { domain: 'www.site.test' })).status).toBe(403)
    expect((await api(admin, 'POST', `/api/admin/tracking-sites/${site.id}/check`, { domain: '127.0.0.1' })).status).toBe(400)
    expect((await api(admin, 'POST', `/api/admin/tracking-sites/${site.id}/check`, {})).status).toBe(400)
  })
})
