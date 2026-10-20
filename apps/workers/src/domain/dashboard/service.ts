// 仪表盘：按时间范围统计线索、客户、跟进与访客；可见范围沿用线索 / 客户的规则（销售只看自己的）
// 访客与团队排行只给管理员、运营
// 按来源筛选：线索按 source；客户、跟进按其来源线索；来源是某个网站（站点域名或名称）时，访客也只统计这个网站
import type { Actor } from '../actor'
import { leadVisibility } from '../leads/policy'
import { clientVisibility } from '../clients/policy'
import { localDateSql, todayIn, type DayRange } from '../timeRange'

interface Count { n: number }
const num = (r: Count | null) => r?.n ?? 0

export interface DashboardData {
  range: { from: string; to: string; days: string[] }
  source: string | null
  /** 按来源筛选时，访客统计对应的网站；来源不是网站时为 null（不显示访客） */
  visitorSite: string | null
  kpis: {
    newLeads: { value: number; prev: number }
    newClients: { value: number; prev: number }
    convertedLeads: number
    followups: { value: number; prev: number }
    visitors?: { value: number; prev: number }
    siteLeads?: number
  }
  trend: { day: string; leads: number; visitors?: number }[]
  sources: { source: string; count: number }[]
  statuses: { status: string; count: number }[]
  todo: { overdueLeads: number; todayLeads: number; overdueClients: number; todayClients: number }
  leaderboard?: { userId: string; name: string; leads: number; followups: number; clients: number }[]
}

export async function getDashboard(db: D1Database, actor: Actor, range: DayRange, tz: string, source?: string | null): Promise<DashboardData> {
  const src = source?.trim() || null
  const vis = leadVisibility(actor, 'l')
  const cvis = clientVisibility(actor, 'c')
  // 来源条件拼在可见范围后面（各查询都用 lv / cv 两组条件，参数顺序一致）
  const lv = src ? { sql: `${vis.sql} AND l.source = ?`, params: [...vis.params, src] } : vis
  const cv = src
    ? { sql: `${cvis.sql} AND c.lead_id IN (SELECT id FROM leads WHERE source = ?)`, params: [...cvis.params, src] }
    : cvis
  const staff = actor.role !== 'sales'
  // 跟进次数：销售只算自己写的，其它角色算全部；系统变更记录不算
  const avBase = staff ? { sql: '', params: [] as unknown[] } : { sql: ' AND sa.user_id = ?', params: [actor.userId] as unknown[] }
  const av = src ? {
    sql: `${avBase.sql} AND (sa.lead_id IN (SELECT id FROM leads WHERE source = ?) OR sa.client_id IN (SELECT c2.id FROM clients c2 JOIN leads l2 ON l2.id = c2.lead_id WHERE l2.source = ?))`,
    params: [...avBase.params, src, src],
  } : avBase

  const leadsIn = (s: string, e: string, extra = '') => db.prepare(
    `SELECT COUNT(*) AS n FROM leads l WHERE l.deleted_at IS NULL AND l.created_at >= ? AND l.created_at < ?${extra}${lv.sql}`,
  ).bind(s, e, ...lv.params).first<Count>()
  const clientsIn = (s: string, e: string) => db.prepare(
    `SELECT COUNT(*) AS n FROM clients c WHERE c.deleted_at IS NULL AND c.created_at >= ? AND c.created_at < ?${cv.sql}`,
  ).bind(s, e, ...cv.params).first<Count>()
  const followupsIn = (s: string, e: string) => db.prepare(
    `SELECT COUNT(*) AS n FROM sales_activities sa WHERE sa.activity_type != 'System' AND sa.created_at >= ? AND sa.created_at < ?${av.sql}`,
  ).bind(s, e, ...av.params).first<Count>()
  // 来源是网站时只统计该网站的访客
  const site = src ? await db.prepare('SELECT id FROM tracking_sites WHERE domain = ? OR name = ? LIMIT 1').bind(src, src).first<{ id: string }>() : null
  const sv = site ? { sql: ' AND site_id = ?', params: [site.id] } : { sql: '', params: [] as unknown[] }
  const visitorsIn = (s: string, e: string) => db.prepare(
    `SELECT COUNT(*) AS n FROM (SELECT DISTINCT site_id, visitor_id FROM visits WHERE started_at >= ? AND started_at < ?${sv.sql})`,
  ).bind(s, e, ...sv.params).first<Count>()

  const { startUtc: s, endUtc: e, prevStartUtc: ps, prevEndUtc: pe } = range
  const leadDay = localDateSql('l.created_at', range)
  const today = todayIn(tz)

  const [newLeads, prevLeads, converted, newClients, prevClients, followups, prevFollowups, trendRows, sourceRows, statusRows, todo] = await Promise.all([
    leadsIn(s, e), leadsIn(ps, pe), leadsIn(s, e, " AND l.status = 'Converted'"),
    clientsIn(s, e), clientsIn(ps, pe),
    followupsIn(s, e), followupsIn(ps, pe),
    db.prepare(`SELECT ${leadDay} AS day, COUNT(*) AS n FROM leads l WHERE l.deleted_at IS NULL AND l.created_at >= ? AND l.created_at < ?${lv.sql} GROUP BY day`)
      .bind(s, e, ...lv.params).all<{ day: string; n: number }>(),
    db.prepare(`SELECT COALESCE(NULLIF(TRIM(l.source), ''), '—') AS source, COUNT(*) AS n FROM leads l WHERE l.deleted_at IS NULL AND l.created_at >= ? AND l.created_at < ?${lv.sql} GROUP BY 1 ORDER BY n DESC`)
      .bind(s, e, ...lv.params).all<{ source: string; n: number }>(),
    db.prepare(`SELECT l.status AS status, COUNT(*) AS n FROM leads l WHERE l.deleted_at IS NULL AND l.created_at >= ? AND l.created_at < ?${lv.sql} GROUP BY l.status ORDER BY n DESC`)
      .bind(s, e, ...lv.params).all<{ status: string; n: number }>(),
    // 待跟进（不受时间范围影响）：下次联系日期早于今天 / 就是今天，已转化、已丢失的线索不算
    db.prepare(`SELECT
        (SELECT COUNT(*) FROM leads l WHERE l.deleted_at IS NULL AND l.status NOT IN ('Converted', 'Lost') AND l.next_contact_date IS NOT NULL AND substr(l.next_contact_date, 1, 10) < ?${lv.sql}) AS overdue_leads,
        (SELECT COUNT(*) FROM leads l WHERE l.deleted_at IS NULL AND l.status NOT IN ('Converted', 'Lost') AND substr(l.next_contact_date, 1, 10) = ?${lv.sql}) AS today_leads,
        (SELECT COUNT(*) FROM clients c WHERE c.deleted_at IS NULL AND c.next_contact_date IS NOT NULL AND substr(c.next_contact_date, 1, 10) < ?${cv.sql}) AS overdue_clients,
        (SELECT COUNT(*) FROM clients c WHERE c.deleted_at IS NULL AND substr(c.next_contact_date, 1, 10) = ?${cv.sql}) AS today_clients`)
      .bind(today, ...lv.params, today, ...lv.params, today, ...cv.params, today, ...cv.params)
      .first<{ overdue_leads: number; today_leads: number; overdue_clients: number; today_clients: number }>(),
  ])

  // 来源最多显示 8 个，其余合并为「其它」
  const sources = sourceRows.results.slice(0, 8).map((r) => ({ source: r.source, count: r.n }))
  const rest = sourceRows.results.slice(8).reduce((sum, r) => sum + r.n, 0)
  if (rest > 0) sources.push({ source: '__other__', count: rest })

  const leadsByDay = new Map(trendRows.results.map((r) => [r.day, r.n]))
  const data: DashboardData = {
    range: { from: range.from, to: range.to, days: range.days },
    source: src,
    visitorSite: site?.id ?? null,
    kpis: {
      newLeads: { value: num(newLeads), prev: num(prevLeads) },
      newClients: { value: num(newClients), prev: num(prevClients) },
      convertedLeads: num(converted),
      followups: { value: num(followups), prev: num(prevFollowups) },
    },
    trend: range.days.map((day) => ({ day, leads: leadsByDay.get(day) ?? 0 })),
    sources,
    statuses: statusRows.results.map((r) => ({ status: r.status, count: r.n })),
    todo: {
      overdueLeads: todo?.overdue_leads ?? 0, todayLeads: todo?.today_leads ?? 0,
      overdueClients: todo?.overdue_clients ?? 0, todayClients: todo?.today_clients ?? 0,
    },
  }
  if (!staff) return data

  // 团队排行：启用中的销售，在范围内新分配的线索、写的跟进、负责的新客户
  const board = await db.prepare(`SELECT u.id AS user_id, u.name,
      (SELECT COUNT(*) FROM leads l WHERE l.assigned_to_userId = u.id AND l.deleted_at IS NULL AND l.created_at >= ? AND l.created_at < ?${lv.sql}) AS leads,
      (SELECT COUNT(*) FROM sales_activities sa WHERE sa.user_id = u.id AND sa.activity_type != 'System' AND sa.created_at >= ? AND sa.created_at < ?${av.sql}) AS followups,
      (SELECT COUNT(*) FROM clients c WHERE c.assigned_sales_userId = u.id AND c.deleted_at IS NULL AND c.created_at >= ? AND c.created_at < ?${cv.sql}) AS clients
    FROM users u WHERE u.role = 'sales' AND u.is_active = 1`)
    .bind(s, e, ...lv.params, s, e, ...av.params, s, e, ...cv.params).all<{ user_id: string; name: string; leads: number; followups: number; clients: number }>()
  data.leaderboard = board.results
    .map((r) => ({ userId: r.user_id, name: r.name, leads: r.leads, followups: r.followups, clients: r.clients }))
    .sort((a, b) => b.clients - a.clients || b.leads - a.leads || b.followups - a.followups)

  // 按来源筛选且来源不是网站时，访客数据没有意义，不返回
  if (src && !site) return data
  const visitDay = localDateSql('started_at', range)
  const [visitors, prevVisitors, siteLeads, visitorRows] = await Promise.all([
    visitorsIn(s, e), visitorsIn(ps, pe),
    leadsIn(s, e, ' AND l.visitor_id IS NOT NULL'),
    db.prepare(`SELECT day, COUNT(*) AS n FROM (SELECT DISTINCT ${visitDay} AS day, site_id, visitor_id FROM visits WHERE started_at >= ? AND started_at < ?${sv.sql}) GROUP BY day`)
      .bind(s, e, ...sv.params).all<{ day: string; n: number }>(),
  ])
  const visitorsByDay = new Map(visitorRows.results.map((r) => [r.day, r.n]))
  data.kpis.visitors = { value: num(visitors), prev: num(prevVisitors) }
  data.kpis.siteLeads = num(siteLeads)
  data.trend = data.trend.map((d) => ({ ...d, visitors: visitorsByDay.get(d.day) ?? 0 }))
  return data
}
