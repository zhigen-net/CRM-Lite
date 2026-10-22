// 单个网站的数据分析（「接入 → 网站」抽屉的概览）：访客、访问、浏览、留资、来源、页面、设备、地区、关键行为
// 只读访问（visits）、浏览明细（track_events）和线索，都按 site_id + 时间走索引
import { notFound } from '../errors'
import { localDateSql, type DayRange } from '../timeRange'

export interface SiteStats {
  kpis: {
    visitors: { value: number; prev: number }
    visits: number
    pageviews: number
    avgDurationSec: number
    bounceRate: number
    leads: { value: number; prev: number }
  }
  trend: { day: string; visitors: number; leads: number }[]
  channels: { channel: string; visits: number }[]
  /** 具体来源：按渠道 + 来源域名 / 广告点击 ID / utm_source / 计划汇总，前端格式化显示 */
  sources: { channel: string; host: string | null; clickIdType: string | null; utmSource: string | null; utmCampaign: string | null; visits: number }[]
  landings: { host: string | null; path: string; visits: number }[]
  pages: { path: string; views: number }[]
  devices: { device: string; visits: number }[]
  countries: { country: string; visits: number }[]
  actions: { type: string; count: number }[]
}

const n = (v: { n: number } | null) => v?.n ?? 0
/** 页面按路径汇总：去掉查询参数（广告参数、UTM 等），同一页面算一个 */
const pathSql = (col: string) => `CASE WHEN instr(COALESCE(${col}, '/'), '?') > 0 THEN substr(${col}, 1, instr(${col}, '?') - 1) ELSE COALESCE(${col}, '/') END`
const hostOf = (url: string | null) => {
  if (!url) return null
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') } catch { return null }
}

export async function getSiteStats(db: D1Database, siteId: string, range: DayRange): Promise<SiteStats> {
  const site = await db.prepare('SELECT id, name, domain FROM tracking_sites WHERE id = ?').bind(siteId).first<{ id: string; name: string; domain: string | null }>()
  if (!site) throw notFound('站点不存在')
  const s = range.startUtc, e = range.endUtc
  // 网站表单线索的来源记为站点域名（未填域名时用站点名称）
  const leadSource = site.domain || site.name
  const visitDay = localDateSql('started_at', range)
  const leadDay = localDateSql('created_at', range)

  const visitorsIn = (a: string, b: string) => db.prepare(
    'SELECT COUNT(DISTINCT visitor_id) AS n FROM visits WHERE site_id = ? AND started_at >= ? AND started_at < ?',
  ).bind(siteId, a, b).first<{ n: number }>()
  const leadsIn = (a: string, b: string) => db.prepare(
    'SELECT COUNT(*) AS n FROM leads WHERE deleted_at IS NULL AND source = ? AND created_at >= ? AND created_at < ?',
  ).bind(leadSource, a, b).first<{ n: number }>()
  const byVisits = (col: string, limit: number) => db.prepare(
    `SELECT COALESCE(${col}, '') AS k, COUNT(*) AS n FROM visits WHERE site_id = ? AND started_at >= ? AND started_at < ? GROUP BY 1 ORDER BY n DESC LIMIT ?`,
  ).bind(siteId, s, e, limit).all<{ k: string; n: number }>()

  const [visitors, prevVisitors, leads, prevLeads, totals, visitorDays, leadDays, channels, sourceRows, landings, pages, devices, countries, actions] = await Promise.all([
    visitorsIn(s, e), visitorsIn(range.prevStartUtc, range.prevEndUtc),
    leadsIn(s, e), leadsIn(range.prevStartUtc, range.prevEndUtc),
    db.prepare(`SELECT COUNT(*) AS visits, COALESCE(SUM(pageviews), 0) AS pageviews, COALESCE(AVG(duration_sec), 0) AS avg_duration,
        COALESCE(SUM(pageviews <= 1), 0) AS bounces
      FROM visits WHERE site_id = ? AND started_at >= ? AND started_at < ?`)
      .bind(siteId, s, e).first<{ visits: number; pageviews: number; avg_duration: number; bounces: number }>(),
    db.prepare(`SELECT day, COUNT(*) AS n FROM (SELECT DISTINCT ${visitDay} AS day, visitor_id FROM visits WHERE site_id = ? AND started_at >= ? AND started_at < ?) GROUP BY day`)
      .bind(siteId, s, e).all<{ day: string; n: number }>(),
    db.prepare(`SELECT ${leadDay} AS day, COUNT(*) AS n FROM leads WHERE deleted_at IS NULL AND source = ? AND created_at >= ? AND created_at < ? GROUP BY day`)
      .bind(leadSource, s, e).all<{ day: string; n: number }>(),
    byVisits('channel', 10),
    db.prepare(`SELECT COALESCE(channel, 'direct') AS channel, referrer, click_id_type, utm_source, utm_campaign, COUNT(*) AS n
      FROM visits WHERE site_id = ? AND started_at >= ? AND started_at < ? AND COALESCE(channel, 'direct') != 'direct'
      GROUP BY 1, 2, 3, 4, 5 ORDER BY n DESC LIMIT 300`)
      .bind(siteId, s, e).all<{ channel: string; referrer: string | null; click_id_type: string | null; utm_source: string | null; utm_campaign: string | null; n: number }>(),
    db.prepare(`SELECT landing_host AS host, ${pathSql('landing_path')} AS path, COUNT(*) AS n FROM visits
      WHERE site_id = ? AND started_at >= ? AND started_at < ? GROUP BY 1, 2 ORDER BY n DESC LIMIT 10`)
      .bind(siteId, s, e).all<{ host: string | null; path: string; n: number }>(),
    db.prepare(`SELECT ${pathSql('path')} AS path, COUNT(*) AS n FROM track_events
      WHERE site_id = ? AND created_at >= ? AND created_at < ? AND type = 'pageview' GROUP BY 1 ORDER BY n DESC LIMIT 10`)
      .bind(siteId, s, e).all<{ path: string; n: number }>(),
    byVisits('device_type', 5),
    byVisits('country', 8),
    db.prepare(`SELECT type, COUNT(*) AS n FROM track_events
      WHERE site_id = ? AND created_at >= ? AND created_at < ? AND type NOT IN ('pageview', 'leave') GROUP BY type ORDER BY n DESC`)
      .bind(siteId, s, e).all<{ type: string; n: number }>(),
  ])

  // 来源按「渠道 + 来源域名 + 点击 ID + utm_source + 计划」合并（同一搜索引擎的不同网址算一个）
  const sources = new Map<string, SiteStats['sources'][number]>()
  for (const r of sourceRows.results) {
    const host = hostOf(r.referrer)
    const key = [r.channel, host, r.click_id_type, r.utm_source, r.utm_campaign].join('|')
    const cur = sources.get(key)
    if (cur) cur.visits += r.n
    else sources.set(key, { channel: r.channel, host, clickIdType: r.click_id_type, utmSource: r.utm_source, utmCampaign: r.utm_campaign, visits: r.n })
  }

  const vByDay = new Map(visitorDays.results.map((r) => [r.day, r.n]))
  const lByDay = new Map(leadDays.results.map((r) => [r.day, r.n]))
  const visits = totals?.visits ?? 0
  return {
    kpis: {
      visitors: { value: n(visitors), prev: n(prevVisitors) },
      visits,
      pageviews: totals?.pageviews ?? 0,
      avgDurationSec: Math.round(totals?.avg_duration ?? 0),
      bounceRate: visits > 0 ? (totals?.bounces ?? 0) / visits : 0,
      leads: { value: n(leads), prev: n(prevLeads) },
    },
    trend: range.days.map((day) => ({ day, visitors: vByDay.get(day) ?? 0, leads: lByDay.get(day) ?? 0 })),
    channels: channels.results.map((r) => ({ channel: r.k || 'direct', visits: r.n })),
    sources: [...sources.values()].sort((a, b) => b.visits - a.visits).slice(0, 10),
    landings: landings.results.map((r) => ({ host: r.host, path: r.path, visits: r.n })),
    pages: pages.results.map((r) => ({ path: r.path, views: r.n })),
    devices: devices.results.map((r) => ({ device: r.k || 'unknown', visits: r.n })),
    countries: countries.results.map((r) => ({ country: r.k, visits: r.n })),
    actions: actions.results.map((r) => ({ type: r.type, count: r.n })),
  }
}
