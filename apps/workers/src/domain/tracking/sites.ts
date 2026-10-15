// 站点管理：每个接入统计的网站一把站点密钥（只在服务器端转发代码中使用，CRM 只存哈希）
import { badRequest, notFound } from '../errors'
import { toCamelList } from '../../shared/db'

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function newSiteKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  return `cts_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

export interface TrackingSite { id: string; name: string; isActive: boolean }

interface SiteRow {
  id: string; name: string; domain: string | null; keyPrefix: string; isActive: boolean | number
  createdAt: string; lastSeenAt: string | null; visitorCount: number
}

/** 按站点密钥查找启用中的站点；找不到返回 null */
export async function findSiteByKey(db: D1Database, key: string | undefined): Promise<TrackingSite | null> {
  if (!key?.startsWith('cts_')) return null
  const row = await db.prepare('SELECT id, name, is_active FROM tracking_sites WHERE key_hash = ?')
    .bind(await sha256Hex(key)).first<{ id: string; name: string; is_active: number }>()
  return row && row.is_active ? { id: row.id, name: row.name, isActive: true } : null
}

export async function listSites(db: D1Database) {
  const rows = await db.prepare(`
    SELECT s.id, s.name, s.domain, s.key_prefix, s.is_active, s.created_at, s.last_seen_at,
      (SELECT COUNT(*) FROM visitors v WHERE v.site_id = s.id) AS visitor_count
    FROM tracking_sites s ORDER BY s.created_at DESC`).all<Record<string, unknown>>()
  return toCamelList<SiteRow>(rows.results).map((r) => ({ ...r, isActive: !!r.isActive }))
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

export async function updateSite(db: D1Database, id: string, patch: { name?: string | undefined; domain?: string | null | undefined; isActive?: boolean | undefined }) {
  const sets: string[] = []
  const params: unknown[] = []
  if (patch.name !== undefined) { if (!patch.name.trim()) throw badRequest('请填写站点名称'); sets.push('name = ?'); params.push(patch.name.trim()) }
  if (patch.domain !== undefined) { sets.push('domain = ?'); params.push(patch.domain?.trim() || null) }
  if (patch.isActive !== undefined) { sets.push('is_active = ?'); params.push(patch.isActive ? 1 : 0) }
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
