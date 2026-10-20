// 浏览事件明细的手动清理（管理员在「接入 → 网站」里操作）
// 只删 track_events（每一页的浏览、点击明细）；访问、访客汇总（来源、落地页、IP、线索关联）都保留
// 删除也算写入额度：每次最多删 PURGE_CHUNK × 站点数 条，界面上可以继续清理剩余的
import { badRequest } from '../errors'

export const PURGE_CHUNK = 5000
const MIN_DAYS = 30

const cutoffSql = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ')

function checkDays(days: number) {
  if (!Number.isInteger(days) || days < MIN_DAYS || days > 3650) throw badRequest(`保留天数应在 ${MIN_DAYS}–3650 之间`)
}

/** 事件总数、最早时间，以及早于 days 天的条数 */
export async function trackEventStats(db: D1Database, days: number) {
  checkDays(days)
  const row = await db.prepare(`SELECT COUNT(*) AS total, MIN(created_at) AS oldest,
      SUM(CASE WHEN created_at < ? THEN 1 ELSE 0 END) AS older FROM track_events`).bind(cutoffSql(days))
    .first<{ total: number; oldest: string | null; older: number | null }>()
  return { total: row?.total ?? 0, oldest: row?.oldest ?? null, older: row?.older ?? 0, cutoff: cutoffSql(days) }
}

/** 删除早于 days 天的事件（按站点分批，走 site_id + created_at 索引）；返回本次删除条数与剩余条数 */
export async function purgeTrackEvents(db: D1Database, days: number) {
  checkDays(days)
  const cutoff = cutoffSql(days)
  const sites = await db.prepare('SELECT DISTINCT site_id FROM track_events').all<{ site_id: string }>()
  let deleted = 0
  for (const { site_id } of sites.results) {
    const res = await db.prepare(`DELETE FROM track_events WHERE id IN (
      SELECT id FROM track_events WHERE site_id = ? AND created_at < ? LIMIT ?)`).bind(site_id, cutoff, PURGE_CHUNK).run()
    deleted += res.meta.changes ?? 0
  }
  const left = await db.prepare('SELECT COUNT(*) AS n FROM track_events WHERE created_at < ?').bind(cutoff).first<{ n: number }>()
  return { deleted, remaining: left?.n ?? 0 }
}
