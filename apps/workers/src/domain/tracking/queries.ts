// 访客数据查询（访客分析页面使用）。可见范围：管理员、运营（入口处校验）
import { badRequest, notFound } from '../errors'
import { toCamel, toCamelList } from '../../shared/db'

export interface VisitorListFilters {
  siteId: string
  channel?: string | undefined
  withLead?: boolean | undefined
  startUtc?: string | undefined
  endUtc?: string | undefined
  page?: number | undefined
  pageSize?: number | undefined
}

export async function listVisitors(db: D1Database, f: VisitorListFilters) {
  if (!f.siteId) throw badRequest('请选择站点')
  const page = Math.max(1, f.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, f.pageSize ?? 30))
  let where = 'WHERE v.site_id = ?'
  const params: unknown[] = [f.siteId]
  if (f.channel) { where += ' AND v.first_channel = ?'; params.push(f.channel) }
  if (f.withLead === true) where += ' AND v.lead_id IS NOT NULL'
  if (f.withLead === false) where += ' AND v.lead_id IS NULL'
  // 时间范围：范围内有访问的访客（UTC 起止，由 timeRange 按系统时区换算）
  if (f.startUtc && f.endUtc) {
    where += ' AND EXISTS (SELECT 1 FROM visits vi WHERE vi.site_id = v.site_id AND vi.visitor_id = v.id AND vi.started_at >= ? AND vi.started_at < ?)'
    params.push(f.startUtc, f.endUtc)
  }

  const [count, rows] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total FROM visitors v ${where}`).bind(...params).first<{ total: number }>(),
    db.prepare(`
      SELECT v.*, l.name AS lead_name,
        (SELECT COUNT(*) FROM track_events e WHERE e.site_id = v.site_id AND e.visitor_id = v.id AND e.type IN ('tel','wechat','form')) AS key_actions
      FROM visitors v LEFT JOIN leads l ON l.id = v.lead_id
      ${where} ORDER BY v.last_seen_at DESC LIMIT ? OFFSET ?`).bind(...params, pageSize, (page - 1) * pageSize).all<Record<string, unknown>>(),
  ])
  return { data: toCamelList(rows.results), total: count?.total ?? 0, page, pageSize }
}

/** 访客详情：基本信息 + 最近 50 次访问 + 每次访问的事件时间线 */
export async function getVisitorJourney(db: D1Database, siteId: string, visitorId: string) {
  const visitor = await db.prepare(`SELECT v.*, l.name AS lead_name, s.domain AS site_domain FROM visitors v
    LEFT JOIN leads l ON l.id = v.lead_id LEFT JOIN tracking_sites s ON s.id = v.site_id WHERE v.site_id = ? AND v.id = ?`)
    .bind(siteId, visitorId).first<Record<string, unknown>>()
  if (!visitor) throw notFound('访客不存在')
  const visits = await db.prepare('SELECT * FROM visits WHERE site_id = ? AND visitor_id = ? ORDER BY started_at DESC LIMIT 50')
    .bind(siteId, visitorId).all<Record<string, unknown>>()
  const events = await db.prepare(`
    SELECT id, visit_id, type, host, path, title, duration_ms, scroll_pct, meta, created_at FROM track_events
    WHERE site_id = ? AND visitor_id = ? ORDER BY created_at ASC LIMIT 1000`).bind(siteId, visitorId).all<Record<string, unknown>>()
  const byVisit = new Map<string, Record<string, unknown>[]>()
  for (const e of toCamelList(events.results)) {
    const list = byVisit.get(e.visitId as string) ?? []
    list.push(e)
    byVisit.set(e.visitId as string, list)
  }
  return {
    visitor: toCamel(visitor),
    visits: toCamelList(visits.results).map((v) => ({ ...v, events: byVisit.get(v.id as string) ?? [] })),
  }
}
