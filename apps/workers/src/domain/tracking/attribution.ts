// 访客 → 线索 → 客户：留资时关联访客，线索 / 客户详情展示来源与访问轨迹
// 可见范围跟随线索 / 客户本身（能看线索的人就能看它的来源），不需要访客分析权限
import type { Actor } from '../actor'
import { getLead } from '../leads/service'
import { getClient } from '../clients/service'
import { getVisitorJourney } from './queries'
import { parseVisitorId } from './link'

async function findVisitorSite(db: D1Database, visitorId: string) {
  return db.prepare(`
    SELECT v.site_id, s.name AS site_name FROM visitors v JOIN tracking_sites s ON s.id = v.site_id
    WHERE v.id = ? ORDER BY v.last_seen_at DESC LIMIT 1`).bind(visitorId).first<{ site_id: string; site_name: string }>()
}

/** 来源与访问轨迹；线索没有关联访客或访客数据不存在时返回 null */
async function attributionFor(db: D1Database, visitorId: unknown) {
  const id = parseVisitorId(visitorId)
  if (!id) return null
  const site = await findVisitorSite(db, id)
  if (!site) return null
  return { siteId: site.site_id, siteName: site.site_name, ...(await getVisitorJourney(db, site.site_id, id)) }
}

export async function getLeadAttribution(db: D1Database, actor: Actor, leadId: string) {
  const lead = await getLead(db, actor, leadId)
  return attributionFor(db, lead.visitorId)
}

export async function getClientAttribution(db: D1Database, actor: Actor, clientId: string) {
  const client = await getClient(db, actor, clientId)
  return attributionFor(db, await leadVisitorId(db, client.leadId))
}

/** 客户转化前线索上的访客 ID */
export async function leadVisitorId(db: D1Database, leadId: unknown): Promise<string | null> {
  if (typeof leadId !== 'string' || !leadId) return null
  const row = await db.prepare('SELECT visitor_id FROM leads WHERE id = ?').bind(leadId).first<{ visitor_id: string | null }>()
  return row?.visitor_id ?? null
}

/** 给 AI 能力用的精简来源（不含完整轨迹） */
export async function visitorSourceSummary(db: D1Database, visitorId: unknown) {
  const id = parseVisitorId(visitorId)
  if (!id) return null
  const v = await db.prepare(`
    SELECT s.name AS site_name, v.first_seen_at, v.first_channel, v.first_referrer, v.first_landing,
      v.first_utm_source, v.first_utm_medium, v.first_utm_campaign, v.first_click_id_type, v.visit_count, v.pageview_count,
      v.device_type, v.city
    FROM visitors v JOIN tracking_sites s ON s.id = v.site_id WHERE v.id = ? ORDER BY v.last_seen_at DESC LIMIT 1`)
    .bind(id).first<Record<string, unknown>>()
  if (!v) return null
  return {
    site: v.site_name, firstSeenAt: v.first_seen_at, channel: v.first_channel, referrer: v.first_referrer, landing: v.first_landing,
    utmSource: v.first_utm_source, utmMedium: v.first_utm_medium, utmCampaign: v.first_utm_campaign, clickIdType: v.first_click_id_type,
    visits: v.visit_count, pageviews: v.pageview_count, device: v.device_type, city: v.city,
  }
}
