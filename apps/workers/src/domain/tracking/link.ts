// 线索关联访客的基础规则（线索服务与访客采集共用，不依赖其它业务模块，避免循环引用）

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 表单带来的访客 ID：只接受 UUID，其它一律忽略 */
export function parseVisitorId(v: unknown): string | null {
  return typeof v === 'string' && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null
}

/** 新线索关联访客：访客尚未关联线索时记为这条（同一访客多次留资，访客上保留第一条） */
export function linkVisitorStatement(db: D1Database, visitorId: string, leadId: string) {
  return db.prepare('UPDATE visitors SET lead_id = ? WHERE id = ? AND lead_id IS NULL').bind(leadId, visitorId)
}

/** 访客数据晚于线索写入时（如首个浏览事件丢失），采集时补关联 */
export function backfillLeadStatement(db: D1Database, siteId: string, visitorId: string) {
  return db.prepare(`
    UPDATE visitors SET lead_id = (SELECT id FROM leads WHERE visitor_id = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1)
    WHERE site_id = ? AND id = ? AND lead_id IS NULL
      AND EXISTS (SELECT 1 FROM leads WHERE visitor_id = ? AND deleted_at IS NULL)`).bind(visitorId, siteId, visitorId, visitorId)
}
