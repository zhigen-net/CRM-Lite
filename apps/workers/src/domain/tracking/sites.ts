// 站点管理：每个接入统计的网站一把站点密钥（只在服务器端转发代码中使用，CRM 只存哈希）
import { badRequest, notFound } from '../errors'
import { PLATFORMS, type Platform } from './platforms'
import { toCamelList } from '../../shared/db'

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function newSiteKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  return `cts_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

export interface TrackingSite { id: string; name: string; isActive: boolean; ownerId?: string | null }

interface SiteRow {
  id: string; name: string; domain: string | null; keyPrefix: string; isActive: boolean | number
  createdAt: string; lastSeenAt: string | null; visitorCount: number
  visitorsDay?: number; leadsDay?: number; blockedDay?: number; openFailures?: number
  platform?: Platform | null; features?: unknown
}

/** 站点功能开关：统计始终开启；表单默认关闭。connect 只对 Cloudflare 平台有意义（同账号用服务绑定，否则用 CRM_URL） */
export interface SiteFeatures { forms: boolean; connect: 'binding' | 'url' }
export function parseFeatures(v: unknown): SiteFeatures {
  let raw: Record<string, unknown> = {}
  if (typeof v === 'string') { try { raw = JSON.parse(v) as Record<string, unknown> } catch { raw = {} } }
  else if (v && typeof v === 'object') raw = v as Record<string, unknown>
  return { forms: raw.forms === true, connect: raw.connect === 'binding' ? 'binding' : 'url' }
}

/** 按站点密钥查找启用中的站点；找不到返回 null */
export async function findSiteByKey(db: D1Database, key: string | undefined): Promise<TrackingSite | null> {
  if (!key?.startsWith('cts_')) return null
  const row = await db.prepare('SELECT id, name, is_active, created_by_userId FROM tracking_sites WHERE key_hash = ?')
    .bind(await sha256Hex(key)).first<{ id: string; name: string; is_active: number; created_by_userId: string | null }>()
  return row && row.is_active ? { id: row.id, name: row.name, isActive: true, ownerId: row.created_by_userId } : null
}

/** 按 ID 读取站点（含停用的）；不存在时抛错 */
export async function getSite(db: D1Database, id: string) {
  const row = await db.prepare('SELECT id, name, domain, is_active FROM tracking_sites WHERE id = ?')
    .bind(id).first<{ id: string; name: string; domain: string | null; is_active: number }>()
  if (!row) throw notFound('站点不存在')
  return { id: row.id, name: row.name, domain: row.domain, isActive: !!row.is_active }
}

export async function listSites(db: D1Database) {
  const rows = await db.prepare(`
    SELECT s.id, s.name, s.domain, s.key_prefix, s.is_active, s.created_at, s.last_seen_at, s.platform, s.features,
      (SELECT COUNT(*) FROM visitors v WHERE v.site_id = s.id) AS visitor_count,
      -- 近 24 小时：访客、留资（网站表单与对外接口带访客 ID 的都算）、被拦截的提交、待处理的失败
      (SELECT COUNT(*) FROM visitors v WHERE v.site_id = s.id AND v.last_seen_at > datetime('now', '-1 day')) AS visitors_day,
      (SELECT COUNT(*) FROM leads l JOIN visitors v ON v.id = l.visitor_id AND v.site_id = s.id
        WHERE l.deleted_at IS NULL AND l.created_at > datetime('now', '-1 day')) AS leads_day,
      (SELECT COUNT(*) FROM site_lead_submissions b WHERE b.site_id = s.id AND b.status IN ('spam', 'rate_limited', 'invalid')
        AND b.created_at > datetime('now', '-1 day')) AS blocked_day,
      (SELECT COUNT(*) FROM api_lead_failures f WHERE f.site_id = s.id AND f.resolved_at IS NULL) AS open_failures
    FROM tracking_sites s ORDER BY s.created_at DESC`).all<Record<string, unknown>>()
  return toCamelList<SiteRow>(rows.results).map((r) => ({ ...r, isActive: !!r.isActive, features: parseFeatures(r.features) }))
}

/** 新建站点，返回明文密钥（只显示一次） */
export async function createSite(db: D1Database, userId: string, input: { name: string; domain?: string | null | undefined }) {
  const name = input.name.trim()
  if (!name) throw badRequest('请填写站点名称')
  const id = crypto.randomUUID()
  const key = newSiteKey()
  await db.prepare('INSERT INTO tracking_sites (id, name, domain, key_hash, key_prefix, created_by_userId) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, name, input.domain?.trim() || null, await sha256Hex(key), key.slice(0, 12), userId).run()
  return { id, name, key, keyPrefix: key.slice(0, 12) }
}

export async function updateSite(db: D1Database, id: string, patch: {
  name?: string | undefined; domain?: string | null | undefined; isActive?: boolean | undefined
  platform?: string | null | undefined; features?: { forms?: boolean | undefined; connect?: 'binding' | 'url' | undefined } | undefined
}) {
  const sets: string[] = []
  const params: unknown[] = []
  if (patch.name !== undefined) { if (!patch.name.trim()) throw badRequest('请填写站点名称'); sets.push('name = ?'); params.push(patch.name.trim()) }
  if (patch.domain !== undefined) { sets.push('domain = ?'); params.push(patch.domain?.trim() || null) }
  if (patch.isActive !== undefined) { sets.push('is_active = ?'); params.push(patch.isActive ? 1 : 0) }
  if (patch.platform !== undefined) {
    if (patch.platform !== null && !(PLATFORMS as readonly string[]).includes(patch.platform)) throw badRequest(`无效的部署平台：${patch.platform}`)
    sets.push('platform = ?'); params.push(patch.platform)
  }
  if (patch.features !== undefined) { sets.push('features = ?'); params.push(JSON.stringify(parseFeatures(patch.features))) }
  if (sets.length === 0) throw badRequest('未提供任何要更新的字段')
  const res = await db.prepare(`UPDATE tracking_sites SET ${sets.join(', ')} WHERE id = ?`).bind(...params, id).run()
  if (!res.meta.changes) throw notFound('站点不存在')
}

/** 更换密钥：旧密钥立即失效，返回新的明文密钥 */
export async function rotateSiteKey(db: D1Database, id: string) {
  const key = newSiteKey()
  const res = await db.prepare('UPDATE tracking_sites SET key_hash = ?, key_prefix = ? WHERE id = ?')
    .bind(await sha256Hex(key), key.slice(0, 12), id).run()
  if (!res.meta.changes) throw notFound('站点不存在')
  return { id, key, keyPrefix: key.slice(0, 12) }
}

/** 站点最近的网站表单提交记录（含被拦截的），用于排查 */
export async function listSiteSubmissions(db: D1Database, siteId: string) {
  const rows = await db.prepare(`
    SELECT b.id, b.status, b.created_at, b.lead_id, l.name AS lead_name
    FROM site_lead_submissions b LEFT JOIN leads l ON l.id = b.lead_id
    WHERE b.site_id = ? ORDER BY b.created_at DESC LIMIT 50`).bind(siteId).all<Record<string, unknown>>()
  return toCamelList(rows.results)
}

/** 单个站点（含接入状态），站点详情页使用 */
export async function getSiteDetail(db: D1Database, id: string) {
  const site = (await listSites(db)).find((s) => s.id === id)
  if (!site) throw notFound('站点不存在')
  return site
}
