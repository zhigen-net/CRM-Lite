// 访客统计：UA 解析、渠道识别、采集鉴权与写入、查询权限
import { env, exports } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { isBotUA, parseUserAgent } from '../src/domain/tracking/userAgent'
import { classifySource } from '../src/domain/tracking/channel'
import { api, createUser, type TestUser } from './helpers'

const UA = {
  wechatIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.40',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  bot: 'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
}

describe('UA 解析', () => {
  it('识别设备、系统、App 内置浏览器', () => {
    expect(parseUserAgent(UA.wechatIos)).toEqual({ deviceType: 'mobile', os: 'iOS', browser: 'WeChat' })
    expect(parseUserAgent(UA.androidChrome)).toEqual({ deviceType: 'mobile', os: 'Android', browser: 'Chrome' })
    expect(parseUserAgent(UA.winEdge)).toEqual({ deviceType: 'desktop', os: 'Windows', browser: 'Edge' })
    expect(parseUserAgent(UA.ipad)).toMatchObject({ deviceType: 'tablet', os: 'iOS', browser: 'Safari' })
  })
  it('识别爬虫与空 UA', () => {
    expect(isBotUA(UA.bot)).toBe(true)
    expect(isBotUA('')).toBe(true)
    expect(isBotUA(UA.androidChrome)).toBe(false)
  })
})

describe('渠道识别', () => {
  it('广告点击 ID / 付费 UTM → paid；搜索、社交、外链、直接', () => {
    expect(classifySource({ params: { bd_vid: 'x1' } })).toMatchObject({ channel: 'paid', clickIdType: 'bd_vid', clickId: 'x1' })
    expect(classifySource({ params: { utm_medium: 'cpc', utm_source: 'baidu' } }).channel).toBe('paid')
    expect(classifySource({ referrer: 'https://www.baidu.com/s?wd=x' }).channel).toBe('search')
    expect(classifySource({ referrer: 'https://www.google.com.hk/' }).channel).toBe('search')
    expect(classifySource({ referrer: 'https://www.xiaohongshu.com/explore' }).channel).toBe('social')
    expect(classifySource({ userAgent: UA.wechatIos }).channel).toBe('social')
    expect(classifySource({ referrer: 'https://partner.example.org/a' }).channel).toBe('referral')
    expect(classifySource({}).channel).toBe('direct')
  })
  it('站内跳转不算来源', () => {
    expect(classifySource({ referrer: 'https://www.site.test/a', pageHost: 'site.test' })).toMatchObject({ channel: 'direct', referrerHost: null })
  })
})

let admin: TestUser, ops: TestUser, sales: TestUser
let siteId: string, siteKey: string

const uuid = () => crypto.randomUUID()
function collect(key: string | null, payload: unknown, headers: Record<string, string> = {}) {
  return exports.default.fetch('http://crm.test/api/t/collect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'User-Agent': UA.androidChrome,
      ...(key ? { 'X-Site-Key': key } : {}), ...headers,
    },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  })
}
const geoHeader = (g: Record<string, unknown>) => ({ 'X-Visitor-Geo': encodeURIComponent(JSON.stringify(g)) })

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ok: (v: T) => boolean = () => true): Promise<T> {
  for (let i = 0; i < 50; i++) {
    const v = await fn()
    if (v && ok(v)) return v
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('等待后台写入超时')
}
const visitRow = (id: string) => env.DB.prepare('SELECT * FROM visits WHERE id = ?').bind(id).first<Record<string, unknown>>()
const visitorRow = (id: string) => env.DB.prepare('SELECT * FROM visitors WHERE site_id = ? AND id = ?').bind(siteId, id).first<Record<string, unknown>>()

beforeAll(async () => {
  admin = await createUser('admin')
  ops = await createUser('operations')
  sales = await createUser('sales')
  const res = await api(admin, 'POST', '/api/admin/tracking-sites', { name: '官网', domain: 'site.test' })
  expect(res.status).toBe(201)
  const data = ((await res.json()) as { data: { id: string; key: string } }).data
  siteId = data.id
  siteKey = data.key
})

describe('站点管理与权限', () => {
  it('只有管理员能管理站点；运营能看站点列表（不含密钥）；销售不能看访客数据', async () => {
    expect((await api(ops, 'POST', '/api/admin/tracking-sites', { name: 'x' })).status).toBe(403)
    const list = (await (await api(ops, 'GET', '/api/tracking/sites')).json()) as { data: Record<string, unknown>[] }
    expect(list.data.find((s) => s.id === siteId)).toBeTruthy()
    expect(JSON.stringify(list.data)).not.toContain('cts_')
    expect((await api(sales, 'GET', `/api/tracking/visitors?siteId=${siteId}`)).status).toBe(403)
  })

  it('接入代码模板：转发 /_t/ 到 /api/t/，带站点密钥与编码后的地理信息；只有管理员可取', async () => {
    expect((await api(ops, 'GET', '/api/admin/tracking-sites/integration')).status).toBe(403)
    const t = ((await (await api(admin, 'GET', '/api/admin/tracking-sites/integration')).json()) as { data: Record<string, string> }).data
    for (const code of [t.pagesFunction!, t.workerSnippet!]) {
      expect(code).toContain("'X-Site-Key': env.CRM_SITE_KEY")
      expect(code).toContain('encodeURIComponent(JSON.stringify')
      expect(code).toContain("replace(/^\\/_t\\//, '/api/t/')")
      expect(code).not.toContain('crm.test')
    }
    expect(t.pagesFunction).toContain('export async function onRequest')
    expect(t.scriptTag).toBe('<script src="/_t/t.js" defer></script>')
  })

  it('采集脚本不含 CRM 地址，只向同域路径上报', async () => {
    const res = await exports.default.fetch('http://crm.test/api/t/t.js')
    const js = await res.text()
    expect(res.headers.get('Content-Type')).toContain('javascript')
    expect(js).toContain("'/_t/collect'")
    expect(js).not.toContain('crm.test')
  })
})

describe('采集', () => {
  it('没有或错误的站点密钥 401；格式错误 400', async () => {
    expect((await collect(null, {})).status).toBe(401)
    expect((await collect('cts_wrong', {})).status).toBe(401)
    expect((await collect(siteKey, '{bad')).status).toBe(400)
  })

  it('新访问：记录来源、广告参数、设备、地区和 IP', async () => {
    const v = uuid(), s = uuid()
    const res = await collect(siteKey, {
      v, s, scr: '390x844', lg: 'zh-CN', net: '4g',
      e: [{ id: uuid(), t: 'pageview', p: '/landing?bd_vid=abc', ti: '首页', r: 'https://www.baidu.com/', h: 'site.test',
        q: { bd_vid: 'abc', utm_source: 'baidu', utm_campaign: '品牌词' } }],
    }, geoHeader({ ip: '203.0.113.9', country: 'CN', region: '广东', city: '深圳', isp: 'China Telecom' }))
    expect(res.status).toBe(204)
    const visit = await waitFor(() => visitRow(s))
    expect(visit).toMatchObject({
      channel: 'paid', click_id_type: 'bd_vid', click_id: 'abc', utm_source: 'baidu', utm_campaign: '品牌词',
      landing_path: '/landing?bd_vid=abc', device_type: 'mobile', os: 'Android', browser: 'Chrome',
      city: '深圳', isp: 'China Telecom', screen: '390x844', pageviews: 1,
    })
    expect(visit?.ip).toBe('203.0.113.9')
    expect(String(visit.ip_hash)).toMatch(/^[0-9a-f]{32}$/)
    expect(await visitorRow(v)).toMatchObject({ visit_count: 1, pageview_count: 1, first_channel: 'paid', first_utm_campaign: '品牌词', last_ip: '203.0.113.9' })
  })

  it('IP 格式不对时不保存', async () => {
    const s = uuid()
    await collect(siteKey, { v: uuid(), s, e: [{ id: uuid(), t: 'pageview', p: '/', h: 'site.test' }] }, geoHeader({ ip: "1.2.3.4'; DROP TABLE visits;--" }))
    const visit = await waitFor(() => visitRow(s))
    expect(visit?.ip).toBeNull()
    expect(visit?.ip_hash).toBeNull()
  })

  it('同一会话：累加浏览与停留时长；新会话增加访问次数；重复事件只记一次', async () => {
    const v = uuid(), s1 = uuid(), s2 = uuid(), dupId = uuid()
    await collect(siteKey, { v, s: s1, e: [{ id: dupId, t: 'pageview', p: '/', h: 'site.test' }] })
    await waitFor(() => visitRow(s1))
    await collect(siteKey, { v, s: s1, e: [{ id: dupId, t: 'pageview', p: '/' }, { id: uuid(), t: 'leave', p: '/', d: 12_000, sc: 80 }] })
    await waitFor(() => visitRow(s1), (r) => r.duration_sec === 12)
    const events = await env.DB.prepare('SELECT COUNT(*) AS n FROM track_events WHERE visit_id = ?').bind(s1).first<{ n: number }>()
    expect(events?.n).toBe(2)
    await collect(siteKey, { v, s: s2, e: [{ id: uuid(), t: 'pageview', p: '/price', h: 'site.test' }, { id: uuid(), t: 'tel', p: '/price' }] })
    const visitor = await waitFor(() => visitorRow(v), (r) => r.visit_count === 2)
    expect(visitor.first_channel).toBe('direct')
  })

  it('爬虫、自动化浏览器、非法 ID 的请求不写入', async () => {
    const s1 = uuid(), s2 = uuid(), s3 = uuid()
    expect((await collect(siteKey, { v: uuid(), s: s1, e: [{ id: uuid(), t: 'pageview', p: '/' }] }, { 'User-Agent': UA.bot })).status).toBe(204)
    await collect(siteKey, { v: uuid(), s: s2, wd: 1, e: [{ id: uuid(), t: 'pageview', p: '/' }] })
    await collect(siteKey, { v: 'not-a-uuid', s: s3, e: [{ id: uuid(), t: 'pageview', p: '/' }] })
    await new Promise((r) => setTimeout(r, 200))
    for (const s of [s1, s2, s3]) expect(await visitRow(s)).toBeNull()
  })

  it('停用站点或更换密钥后，旧密钥失效', async () => {
    const res = await api(admin, 'POST', '/api/admin/tracking-sites', { name: '临时站' })
    const site = ((await res.json()) as { data: { id: string; key: string } }).data
    const rotated = ((await (await api(admin, 'POST', `/api/admin/tracking-sites/${site.id}/rotate-key`)).json()) as { data: { key: string } }).data
    expect((await collect(site.key, {})).status).toBe(401)
    expect((await collect(rotated.key, { v: uuid(), s: uuid(), e: [] })).status).toBe(204)
    await api(admin, 'PATCH', `/api/admin/tracking-sites/${site.id}`, { isActive: false })
    expect((await collect(rotated.key, {})).status).toBe(401)
  })
})

describe('查询', () => {
  it('访客列表与访问轨迹', async () => {
    const v = uuid(), s = uuid()
    await collect(siteKey, { v, s, e: [{ id: uuid(), t: 'pageview', p: '/a', ti: 'A', h: 'site.test' }, { id: uuid(), t: 'wechat', p: '/a' }] })
    await waitFor(() => visitRow(s))
    const list = (await (await api(ops, 'GET', `/api/tracking/visitors?siteId=${siteId}&pageSize=100`)).json()) as { data: { id: string; keyActions: number }[] }
    expect(list.data.find((x) => x.id === v)?.keyActions).toBe(1)
    const journey = (await (await api(ops, 'GET', `/api/tracking/visitors/${siteId}/${v}`)).json()) as { data: { visits: { events: { type: string }[] }[] } }
    expect(journey.data.visits[0]?.events.map((e) => e.type)).toEqual(['pageview', 'wechat'])
  })
})
