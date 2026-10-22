// 网站数据分析（接入 → 网站 → 概览）：访客、访问、浏览、来源、页面、关键行为、留资
import { env, exports } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { api, createUser, type TestUser } from './helpers'

let admin: TestUser, ops: TestUser
let siteId: string, siteKey: string
const uuid = () => crypto.randomUUID()
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'
const collect = (payload: unknown) => exports.default.fetch('http://crm.test/api/t/collect', {
  method: 'POST', body: JSON.stringify(payload),
  headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'X-Site-Key': siteKey, 'X-Visitor-Geo': encodeURIComponent(JSON.stringify({ country: 'CN' })) },
})

beforeAll(async () => {
  admin = await createUser('admin')
  ops = await createUser('operations')
  const created = ((await (await api(admin, 'POST', '/api/admin/tracking-sites', { name: '统计站', domain: 'stats.example' })).json()) as { data: { id: string; key: string } }).data
  siteId = created.id; siteKey = created.key
})

describe('网站数据分析', () => {
  it('汇总访客、浏览、来源（具体搜索引擎 / 广告）、页面、关键行为和留资', async () => {
    const google = uuid(), ad = uuid()
    expect((await collect({ v: uuid(), s: google, e: [
      { id: uuid(), t: 'pageview', p: '/a', h: 'stats.example', r: 'https://www.google.com/' },
      { id: uuid(), t: 'pageview', p: '/b', h: 'stats.example' },
      { id: uuid(), t: 'tel', p: '/b', h: 'stats.example' },
    ] })).status).toBe(204)
    expect((await collect({ v: uuid(), s: ad, e: [
      { id: uuid(), t: 'pageview', p: '/a?gclid=x', h: 'stats.example', q: { gclid: 'x', utm_campaign: '品牌词' } },
    ] })).status).toBe(204)
    await env.DB.prepare("INSERT INTO leads (id, source, name, contact_info, status, lead_no) VALUES (?, 'stats.example', '统计留资', '13800009999', 'New', 99999)").bind(uuid()).run()

    const res = await api(admin, 'GET', `/api/admin/tracking-sites/${siteId}/stats`)
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: {
      kpis: { visitors: { value: number }; visits: number; pageviews: number; bounceRate: number; leads: { value: number } }
      sources: { channel: string; host: string | null; clickIdType: string | null; utmCampaign: string | null; visits: number }[]
      pages: { path: string; views: number }[]; actions: { type: string; count: number }[]; trend: { visitors: number; leads: number }[]
    } }
    expect(data.kpis).toMatchObject({ visitors: { value: 2 }, visits: 2, pageviews: 3, bounceRate: 0.5, leads: { value: 1 } })
    expect(data.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'search', host: 'google.com', visits: 1 }),
      expect.objectContaining({ channel: 'paid', clickIdType: 'gclid', utmCampaign: '品牌词', visits: 1 }),
    ]))
    expect(data.pages[0]).toEqual({ path: '/a', views: 2 })
    expect(data.actions).toEqual([{ type: 'tel', count: 1 }])
    expect(data.trend.reduce((a, d) => a + d.visitors, 0)).toBe(2)
  })

  it('只有管理员能查看', async () => {
    expect((await api(ops, 'GET', `/api/admin/tracking-sites/${siteId}/stats`)).status).toBe(403)
  })
})
