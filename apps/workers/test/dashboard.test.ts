// 仪表盘与统计时间范围：按系统时区自然日换算 UTC 起止；销售只看自己的；访客与排行只给管理员、运营
import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { resolveRange, tzOffsetMinutes } from '../src/domain/timeRange'
import { api, createTeam, createUser, insertClient, insertLead, type TestUser } from './helpers'

let admin: TestUser, ops: TestUser, salesA: TestUser, salesB: TestUser

// 用一段很早的日期，避免和其它测试写入的数据混在一起（系统时区默认 Asia/Shanghai，UTC+8）
const FROM = '2020-03-01', TO = '2020-03-07'
const setCreated = (table: string, id: string, utc: string) => env.DB.prepare(`UPDATE ${table} SET created_at = ? WHERE id = ?`).bind(utc, id).run()

beforeAll(async () => {
  await env.DB.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('timezone', 'Asia/Shanghai')").run()
  const team = await createTeam()
  admin = await createUser('admin')
  ops = await createUser('operations')
  salesA = await createUser('sales', team)
  salesB = await createUser('sales', team)

  // 范围内：A 两条（其中一条已转化，来源「广告」），B 一条；3 月 1 日北京时间 0:30 = UTC 2 月 29 日 16:30，应算在范围内
  const a1 = await insertLead({ createdBy: admin.id, assignedTo: salesA.id, teamId: team })
  const a2 = await insertLead({ createdBy: admin.id, assignedTo: salesA.id, teamId: team, status: 'Converted' })
  const b1 = await insertLead({ createdBy: admin.id, assignedTo: salesB.id, teamId: team })
  await setCreated('leads', a1, '2020-02-29 16:30:00')
  await setCreated('leads', a2, '2020-03-03 02:00:00')
  await setCreated('leads', b1, '2020-03-07 15:59:59')
  await env.DB.prepare("UPDATE leads SET source = '广告' WHERE id = ?").bind(a2).run()
  // 范围外：3 月 8 日北京时间 0:00（UTC 3 月 7 日 16:00）；上一周期：2 月 25 日
  const out = await insertLead({ createdBy: admin.id, assignedTo: salesA.id, teamId: team })
  await setCreated('leads', out, '2020-03-07 16:00:00')
  const prev = await insertLead({ createdBy: admin.id, assignedTo: salesA.id, teamId: team })
  await setCreated('leads', prev, '2020-02-25 04:00:00')

  const c1 = await insertClient({ createdBy: admin.id, assignedTo: salesA.id })
  await setCreated('clients', c1, '2020-03-03 03:00:00')
  await env.DB.prepare(`INSERT INTO sales_activities (id, lead_id, client_id, user_id, activity_type, description, activity_date, created_at)
    VALUES (?, ?, NULL, ?, 'Call', '电话', '2020-03-02 10:00:00', '2020-03-02 02:00:00'),
           (?, ?, NULL, ?, 'System', '状态变更', '2020-03-02 10:00:00', '2020-03-02 02:00:00')`)
    .bind(crypto.randomUUID(), a1, salesA.id, crypto.randomUUID(), a1, salesA.id).run()
})

const dash = async (u: TestUser, q = `from=${FROM}&to=${TO}`) => {
  const res = await api(u, 'GET', `/api/dashboard?${q}`)
  return { status: res.status, data: ((await res.json()) as { data: Record<string, any> }).data }
}

describe('时间范围换算', () => {
  it('系统时区的自然日换算为 UTC 起止，上一周期等长', () => {
    const r = resolveRange('Asia/Shanghai', FROM, TO)
    expect(r).toMatchObject({ startUtc: '2020-02-29 16:00:00', endUtc: '2020-03-07 16:00:00', prevStartUtc: '2020-02-22 16:00:00', offsetMinutes: 480 })
    expect(r.days).toHaveLength(7)
    expect(tzOffsetMinutes('America/New_York', new Date('2020-07-01T12:00:00Z'))).toBe(-240)
  })
  it('日期不合法、开始晚于结束、超过 366 天时报错', () => {
    expect(() => resolveRange('Asia/Shanghai', '2020-3-1', TO)).toThrow()
    expect(() => resolveRange('Asia/Shanghai', TO, FROM)).toThrow()
    expect(() => resolveRange('Asia/Shanghai', '2019-01-01', '2020-03-01')).toThrow()
  })
})

describe('仪表盘', () => {
  it('管理员：范围内的线索、转化、客户、跟进（不含系统记录），按天趋势、来源、环比', async () => {
    const { status, data } = await dash(admin)
    expect(status).toBe(200)
    expect(data.kpis).toMatchObject({ newLeads: { value: 3, prev: 1 }, convertedLeads: 1, newClients: { value: 1 }, followups: { value: 1 } })
    expect(data.trend.find((d: { day: string }) => d.day === '2020-03-01').leads).toBe(1)
    expect(data.trend.find((d: { day: string }) => d.day === '2020-03-07').leads).toBe(1)
    expect(data.sources).toEqual(expect.arrayContaining([{ source: '广告', count: 1 }, { source: 'test', count: 2 }]))
    expect(data.kpis.visitors).toBeDefined()
    const row = data.leaderboard.find((r: { userId: string }) => r.userId === salesA.id)
    expect(row).toMatchObject({ leads: 2, followups: 1, clients: 1 })
  })
  it('销售只看自己的线索和跟进，没有访客与排行', async () => {
    const a = (await dash(salesA)).data
    expect(a.kpis).toMatchObject({ newLeads: { value: 2 }, followups: { value: 1 }, newClients: { value: 1 } })
    expect(a.kpis.visitors).toBeUndefined()
    expect(a.leaderboard).toBeUndefined()
    const b = (await dash(salesB)).data
    expect(b.kpis).toMatchObject({ newLeads: { value: 1 }, followups: { value: 0 }, newClients: { value: 0 } })
  })
  it('运营可以看到访客；日期格式错误时 400', async () => {
    expect((await dash(ops)).data.kpis.visitors).toBeDefined()
    expect((await dash(admin, 'from=bad')).status).toBe(400)
  })
})

describe('访客列表的时间范围', () => {
  it('只返回范围内有访问的访客；访客数计入仪表盘', async () => {
    const siteId = ((await (await api(admin, 'POST', '/api/admin/tracking-sites', { name: '范围测试站' })).json()) as { data: { id: string } }).data.id
    const inRange = crypto.randomUUID(), outRange = crypto.randomUUID()
    await env.DB.batch([
      env.DB.prepare("INSERT INTO visitors (site_id, id, first_seen_at, last_seen_at) VALUES (?, ?, '2020-03-02 01:00:00', '2020-03-02 01:00:00')").bind(siteId, inRange),
      env.DB.prepare("INSERT INTO visitors (site_id, id, first_seen_at, last_seen_at) VALUES (?, ?, '2020-03-10 01:00:00', '2020-03-10 01:00:00')").bind(siteId, outRange),
      env.DB.prepare("INSERT INTO visits (id, site_id, visitor_id, started_at, ended_at) VALUES (?, ?, ?, '2020-03-02 01:00:00', '2020-03-02 01:05:00')").bind(crypto.randomUUID(), siteId, inRange),
      env.DB.prepare("INSERT INTO visits (id, site_id, visitor_id, started_at, ended_at) VALUES (?, ?, ?, '2020-03-10 01:00:00', '2020-03-10 01:05:00')").bind(crypto.randomUUID(), siteId, outRange),
    ])
    const list = async (q: string) => ((await (await api(ops, 'GET', `/api/tracking/visitors?siteId=${siteId}${q}`)).json()) as { data: { id: string }[] }).data.map((v) => v.id)
    expect(await list(`&from=${FROM}&to=${TO}`)).toEqual([inRange])
    const withSummary = (await (await api(ops, 'GET', `/api/tracking/visitors?siteId=${siteId}&from=${FROM}&to=${TO}`)).json()) as { total: number; summary: { withLead: number; withActions: number } }
    expect(withSummary).toMatchObject({ total: 1, summary: { withLead: 0, withActions: 0 } })
    expect((await list('')).sort()).toEqual([inRange, outRange].sort())
    const { data } = await dash(admin)
    expect(data.kpis.visitors.value).toBe(1)
    expect(data.trend.find((d: { day: string }) => d.day === '2020-03-02').visitors).toBe(1)
  })
})

describe('按来源筛选', () => {
  it('线索、转化、排行只统计该来源；来源不是网站时不返回访客，是网站时只统计该网站的访客', async () => {
    const { data } = await dash(admin, `from=${FROM}&to=${TO}&source=${encodeURIComponent('广告')}`)
    expect(data.source).toBe('广告')
    expect(data.kpis).toMatchObject({ newLeads: { value: 1 }, convertedLeads: 1 })
    expect(data.kpis.visitors).toBeUndefined()
    expect(data.sources).toEqual([{ source: '广告', count: 1 }])
    expect(data.leaderboard.find((r: { userId: string }) => r.userId === salesA.id)).toMatchObject({ leads: 1, followups: 0 })

    // 上一个用例建了「范围测试站」，范围内有 1 位访客
    const site = (await dash(admin, `from=${FROM}&to=${TO}&source=${encodeURIComponent('范围测试站')}`)).data
    expect(site.kpis.newLeads.value).toBe(0)
    expect(site.kpis.visitors.value).toBe(1)
    expect(site.visitorSite).toBeTruthy()
  })
})
