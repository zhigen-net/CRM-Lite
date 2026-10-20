// 网站表单留资（/_t/lead → /api/t/lead）：站点密钥鉴权后，交给与 /api/v1/leads 相同的 submitExternalLead 处理
// 这里只做网站入口特有的事：确定以谁的身份建线索、防刷（蜜罐字段、提交频率）、补充访客 IP
import type { Actor, Deps, Role } from '../actor'
import { DomainError } from '../errors'
import { submitExternalLead } from '../leads/submit'
import type { VisitorGeo } from './ingest'
import { hashIp, validIp } from './ingest'
import { parseVisitorId } from './link'

/** 浏览器表单里的控制字段，不写入线索 */
export const CONTROL_FIELDS = ['_hp', '_redirect', '_format', '_page'] as const
/** 蜜罐字段：页面上隐藏，正常访客不会填写；有值即视为机器人 */
export const HONEYPOT_FIELD = '_hp'

// 10 分钟内：同一 IP 最多 5 次、同一访客最多 3 次成功或尝试提交
const WINDOW_MINUTES = 10
const MAX_PER_IP = 5
const MAX_PER_VISITOR = 3

export type SiteLeadStatus = 'ok' | 'invalid' | 'rate_limited' | 'spam' | 'error'
export interface SiteLeadResult { status: SiteLeadStatus; leadId?: string; message?: string }

interface SiteForLead { id: string; name: string; ownerId: string | null }

/** 网站提交的线索记在站点创建人名下；创建人已停用时记在任一启用的管理员名下 */
async function siteActor(db: D1Database, site: SiteForLead): Promise<Actor | null> {
  const row = await db.prepare(`
    SELECT id, role, team_id FROM users WHERE is_active = 1 AND (id = ? OR role = 'admin')
    ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, created_at LIMIT 1`).bind(site.ownerId, site.ownerId)
    .first<{ id: string; role: Role; team_id: string | null }>()
  return row ? { userId: row.id, role: row.role, teamId: row.team_id, via: 'site' } : null
}

async function recentCount(db: D1Database, siteId: string, column: 'ip_hash' | 'visitor_id', value: string) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS n FROM site_lead_submissions
    WHERE site_id = ? AND ${column} = ? AND created_at > datetime('now', ?)`)
    .bind(siteId, value, `-${WINDOW_MINUTES} minutes`).first<{ n: number }>()
  return row?.n ?? 0
}

export async function submitSiteLead(
  deps: Deps, site: SiteForLead, raw: Record<string, unknown>, ctx: { geo: VisitorGeo; ipSalt: string },
): Promise<SiteLeadResult> {
  const ip = validIp(ctx.geo.ip)
  const ipHash = await hashIp(ip, ctx.ipSalt)
  const visitorId = parseVisitorId(raw.crm_vid)
  const log = (status: SiteLeadStatus, leadId?: string) => deps.db.prepare(
    'INSERT INTO site_lead_submissions (id, site_id, ip_hash, visitor_id, status, lead_id) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(crypto.randomUUID(), site.id, ipHash, visitorId, status, leadId ?? null).run()

  // 蜜罐：不建线索，但返回成功，避免机器人据此调整
  if (raw[HONEYPOT_FIELD] !== undefined && String(raw[HONEYPOT_FIELD]).trim() !== '') {
    await log('spam')
    return { status: 'spam' }
  }
  if ((ipHash && await recentCount(deps.db, site.id, 'ip_hash', ipHash) >= MAX_PER_IP)
    || (visitorId && await recentCount(deps.db, site.id, 'visitor_id', visitorId) >= MAX_PER_VISITOR)) {
    await log('rate_limited')
    return { status: 'rate_limited', message: '提交过于频繁，请稍后再试' }
  }

  const actor = await siteActor(deps.db, site)
  if (!actor) return { status: 'error', message: '站点暂时无法接收留资' }

  const body: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) if (!(CONTROL_FIELDS as readonly string[]).includes(k)) body[k] = v
  const adInfoDefaults: Record<string, string> = {}
  if (ip) adInfoDefaults.ip = ip
  if (typeof raw._page === 'string' && /^https?:\/\//.test(raw._page)) adInfoDefaults.url = raw._page.slice(0, 500)

  try {
    const { id } = await submitExternalLead(deps, actor, body, {
      defaultSource: site.name, audit: true, failure: { siteId: site.id }, adInfoDefaults,
    })
    await log('ok', id)
    return { status: 'ok', leadId: id }
  } catch (err) {
    const status = err instanceof DomainError ? 'invalid' : 'error'
    await log(status)
    return { status, message: err instanceof Error ? err.message : String(err) }
  }
}
