// 采集写入：网站服务器端转发来的一批行为事件 → 访客 / 访问 / 事件
// 浏览器传来的内容一律视为不可信：字段截断、ID 格式校验、事件数量上限
// IP 来自网站转发代码（Cloudflare 的 CF-Connecting-IP），保存完整值与哈希；只接受 IPv4 / IPv6 格式
import { classifySource, isInternalReferrer, UTM_PARAMS } from './channel'
import { isBotUA, parseUserAgent } from './userAgent'
import type { TrackingSite } from './sites'
import { backfillLeadStatement } from './link'

export const EVENT_TYPES = ['pageview', 'leave', 'tel', 'wechat', 'form', 'custom'] as const
type EventType = typeof EVENT_TYPES[number]

export const MAX_EVENTS_PER_REQUEST = 20
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface RawEvent {
  /** leave 事件对应的浏览事件 ID：停留时长写回那条浏览记录，不再新增事件 */
  pv?: unknown
  id?: unknown; t?: unknown; p?: unknown; ti?: unknown; r?: unknown; h?: unknown
  d?: unknown; sc?: unknown; q?: unknown; m?: unknown
}
export interface CollectPayload {
  v?: unknown        // 访客 ID
  s?: unknown        // 会话 ID
  e?: unknown        // 事件数组
  scr?: unknown      // 屏幕尺寸
  lg?: unknown       // 语言
  net?: unknown      // 网络类型
  wd?: unknown       // navigator.webdriver（自动化浏览器）
}

/** 转发代码附上的访客地理信息（来自网站 Worker 的 request.cf） */
export interface VisitorGeo { ip?: string | null; country?: string | null; region?: string | null; city?: string | null; isp?: string | null }

export interface IngestContext { userAgent: string; geo: VisitorGeo; ipSalt: string }

export type IngestResult = { accepted: number } | { dropped: 'bot' | 'invalid' }

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v ? v.slice(0, max) : null)
const int = (v: unknown, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), max) : null
const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ')

export async function hashIp(ip: string | null | undefined, salt: string): Promise<string | null> {
  if (!ip) return null
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`ip:${ip}`))
  return [...new Uint8Array(sig)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('')
}

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/
const IPV6_RE = /^[0-9a-f:.]{2,45}$/i

/** 只保留格式正确的 IP，其它一律丢弃 */
export function validIp(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const ip = v.trim()
  return IPV4_RE.test(ip) || (ip.includes(':') && IPV6_RE.test(ip)) ? ip : null
}

const HOST_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/

/** 浏览器上报的域名：只接受合法主机名（小写），其它丢弃 */
export function validHost(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const h = v.trim().toLowerCase()
  return HOST_RE.test(h) ? h : null
}

function cleanParams(q: unknown): Record<string, string> {
  if (!q || typeof q !== 'object' || Array.isArray(q)) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(q as Record<string, unknown>).slice(0, 20)) {
    if (typeof v === 'string' && v) out[k.slice(0, 40)] = v.slice(0, 200)
  }
  return out
}

/** 解析转发代码附上的地理信息头（JSON 经 encodeURIComponent 编码，避免非 ASCII 字符） */
export function parseGeoHeader(header: string | undefined): VisitorGeo {
  if (!header) return {}
  try {
    const g = JSON.parse(decodeURIComponent(header)) as Record<string, unknown>
    return {
      ip: str(g.ip, 64), country: str(g.country, 8), region: str(g.region, 80),
      city: str(g.city, 80), isp: str(g.isp ?? g.asOrganization, 120),
    }
  } catch {
    return {}
  }
}

export async function ingestEvents(db: D1Database, site: TrackingSite, payload: CollectPayload, ctx: IngestContext): Promise<IngestResult> {
  if (payload.wd === 1 || payload.wd === true || isBotUA(ctx.userAgent)) return { dropped: 'bot' }
  const visitorId = typeof payload.v === 'string' && UUID_RE.test(payload.v) ? payload.v.toLowerCase() : null
  const visitId = typeof payload.s === 'string' && UUID_RE.test(payload.s) ? payload.s.toLowerCase() : null
  if (!visitorId || !visitId || !Array.isArray(payload.e)) return { dropped: 'invalid' }

  const events = (payload.e as RawEvent[]).slice(0, MAX_EVENTS_PER_REQUEST).filter((e) =>
    e && typeof e === 'object' && typeof e.id === 'string' && UUID_RE.test(e.id) && EVENT_TYPES.includes(e.t as EventType))
  if (events.length === 0) return { dropped: 'invalid' }

  const now = nowSql()
  const ua = parseUserAgent(ctx.userAgent)
  const geo = ctx.geo
  const ip = validIp(geo.ip)
  const ipHash = await hashIp(ip, ctx.ipSalt)
  const pageviews = events.filter((e) => e.t === 'pageview')
  // 新版脚本的离开事件带 pv（浏览事件 ID）：把累计停留时长写回浏览记录；旧版脚本的离开事件照旧单独记一条
  const leaves = events.filter((e) => e.t === 'leave' && typeof e.pv === 'string' && UUID_RE.test(e.pv))
  const inserts = events.filter((e) => !leaves.includes(e))
  const keyActions = inserts.filter((e) => e.t === 'tel' || e.t === 'wechat' || e.t === 'form').length

  const existing = await db.prepare('SELECT 1 AS ok FROM visits WHERE id = ? AND site_id = ?').bind(visitId, site.id).first<{ ok: number }>()
  const stmts: D1PreparedStatement[] = []

  // 离开：用累计时长减去已记录的时长得到增量，重复上报不会多算
  let leaveSec = 0
  for (const e of leaves) {
    const pvId = (e.pv as string).toLowerCase()
    const d = int(e.d, 6 * 3600 * 1000) ?? 0
    const prev = await db.prepare("SELECT duration_ms FROM track_events WHERE id = ? AND site_id = ? AND type = 'pageview'").bind(pvId, site.id).first<{ duration_ms: number | null }>()
    if (!prev) continue
    if (d > (prev.duration_ms ?? 0)) {
      leaveSec += Math.round((d - (prev.duration_ms ?? 0)) / 1000)
      stmts.push(db.prepare('UPDATE track_events SET duration_ms = ?, scroll_pct = MAX(COALESCE(scroll_pct, 0), ?) WHERE id = ?')
        .bind(d, int(e.sc, 100) ?? 0, pvId))
    }
  }
  const durationSec = leaveSec + Math.round(inserts.filter((e) => e.t === 'leave').reduce((sum, e) => sum + (int(e.d, 6 * 3600 * 1000) ?? 0), 0) / 1000)

  if (!existing) {
    // 新会话：来源以第一个浏览事件为准（没有浏览事件时以第一个事件为准）
    const first = pageviews[0] ?? inserts[0] ?? events[0]!
    const params = cleanParams(first.q)
    const referrer = str(first.r, 500)
    const pageHost = validHost(first.h) ?? undefined
    const src = classifySource({ referrer: referrer ?? undefined, pageHost, params, userAgent: ctx.userAgent })
    const externalReferrer = referrer && !isInternalReferrer(referrer, pageHost) ? referrer : null
    const landing = str(first.p, 500)
    const utm = UTM_PARAMS.map((k) => params[k] ?? null)

    stmts.push(db.prepare(`
      INSERT INTO visits (id, site_id, visitor_id, started_at, ended_at, pageviews, duration_sec, landing_path, referrer, channel,
        utm_source, utm_medium, utm_campaign, utm_term, utm_content, click_id_type, click_id,
        device_type, os, browser, screen, language, network, country, region, city, isp, ip_hash, ip, landing_host)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET ended_at = excluded.ended_at, pageviews = visits.pageviews + excluded.pageviews,
        duration_sec = visits.duration_sec + excluded.duration_sec`,
    ).bind(
      visitId, site.id, visitorId, now, now, pageviews.length, durationSec, landing, externalReferrer, src.channel,
      ...utm, src.clickIdType, src.clickId,
      ua.deviceType, ua.os, ua.browser, str(payload.scr, 20), str(payload.lg, 20), str(payload.net, 10),
      geo.country ?? null, geo.region ?? null, geo.city ?? null, geo.isp ?? null, ipHash, ip, pageHost ?? null,
    ))
    stmts.push(db.prepare(`
      INSERT INTO visitors (site_id, id, first_seen_at, last_seen_at, visit_count, pageview_count,
        first_channel, first_referrer, first_landing, first_utm_source, first_utm_medium, first_utm_campaign, first_click_id_type,
        last_channel, device_type, os, browser, country, region, city, isp, last_ip, first_host, key_actions)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(site_id, id) DO UPDATE SET last_seen_at = excluded.last_seen_at, visit_count = visitors.visit_count + 1,
        key_actions = visitors.key_actions + excluded.key_actions,
        pageview_count = visitors.pageview_count + excluded.pageview_count, last_channel = excluded.last_channel,
        device_type = excluded.device_type, os = excluded.os, browser = excluded.browser,
        country = excluded.country, region = excluded.region, city = excluded.city, isp = excluded.isp,
        last_ip = COALESCE(excluded.last_ip, visitors.last_ip)`,
    ).bind(
      site.id, visitorId, now, now, pageviews.length,
      src.channel, externalReferrer, landing, utm[0], utm[1], utm[2], src.clickIdType,
      src.channel, ua.deviceType, ua.os, ua.browser, geo.country ?? null, geo.region ?? null, geo.city ?? null, geo.isp ?? null, ip, pageHost ?? null, keyActions,
    ))
  } else {
    stmts.push(db.prepare('UPDATE visits SET ended_at = ?, pageviews = pageviews + ?, duration_sec = duration_sec + ? WHERE id = ?')
      .bind(now, pageviews.length, durationSec, visitId))
    // 只有离开事件时不更新访客（少写一次，访客的最近访问时间以浏览为准）
    if (inserts.length > 0) {
      stmts.push(db.prepare('UPDATE visitors SET last_seen_at = ?, pageview_count = pageview_count + ?, key_actions = key_actions + ? WHERE site_id = ? AND id = ?')
        .bind(now, pageviews.length, keyActions, site.id, visitorId))
    }
  }
  // 只在新访问或提交表单时补关联线索（线索可能先于访客数据写入）
  if (!existing || events.some((e) => e.t === 'form')) stmts.push(backfillLeadStatement(db, site.id, visitorId))

  for (const e of inserts) {
    const meta = e.m && typeof e.m === 'object' ? JSON.stringify(e.m).slice(0, 500) : null
    stmts.push(db.prepare(`
      INSERT OR IGNORE INTO track_events (id, site_id, visitor_id, visit_id, type, path, title, duration_ms, scroll_pct, meta, created_at, host)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      (e.id as string).toLowerCase(), site.id, visitorId, visitId, e.t, str(e.p, 500), str(e.ti, 200),
      int(e.d, 6 * 3600 * 1000), int(e.sc, 100), meta, now, validHost(e.h),
    ))
  }
  // 站点「最近数据」时间 5 分钟最多更新一次（条件不满足时不产生写入）
  stmts.push(db.prepare("UPDATE tracking_sites SET last_seen_at = ? WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < datetime('now', '-5 minutes'))").bind(now, site.id))

  await db.batch(stmts)
  return { accepted: events.length }
}
