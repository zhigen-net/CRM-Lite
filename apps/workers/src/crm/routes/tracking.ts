// 访客统计接口
// - /api/t/*：网站服务器端转发的采集请求（站点密钥鉴权，不开放跨域，不信任浏览器传来的 IP）
// - /api/admin/tracking-sites：站点管理（管理员）
// - /api/tracking/*：访客数据查询（管理员、运营）
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAdmin, requireAuth, requireNotSales } from '../middleware/auth'
import { TRACKER_SCRIPT } from '../../domain/tracking/script'
import { findSiteByKey, getSite, listSites, createSite, updateSite, rotateSiteKey } from '../../domain/tracking/sites'
import { ingestEvents, parseGeoHeader, type CollectPayload } from '../../domain/tracking/ingest'
import { getVisitorJourney, listVisitors } from '../../domain/tracking/queries'
import { integrationTemplates } from '../../domain/tracking/integration'
import { checkSiteIntegration, normalizeHost } from '../../domain/tracking/check'

const MAX_BODY_BYTES = 16 * 1024

export const trackingCollectRoutes = new Hono<{ Bindings: Env }>()

// 采集脚本：内容不含 CRM 地址，可公开缓存
trackingCollectRoutes.get('/t.js', (c) =>
  c.body(TRACKER_SCRIPT, 200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }))

trackingCollectRoutes.post('/collect', async (c) => {
  const site = await findSiteByKey(c.env.DB, c.req.header('X-Site-Key'))
  if (!site) return c.json({ message: '站点密钥无效或站点已停用' }, 401)

  const text = await c.req.text()
  if (text.length > MAX_BODY_BYTES) return c.json({ message: '请求过大' }, 413)
  let payload: CollectPayload
  try { payload = JSON.parse(text) as CollectPayload } catch { return c.json({ message: '请求格式错误' }, 400) }
  // 接入检测的探测请求：只回报密钥对应的站点，不写入数据
  if (payload && typeof payload === 'object' && 'ping' in payload) return c.json({ data: { siteId: site.id } })

  const ctx = {
    userAgent: c.req.header('User-Agent') ?? '',
    geo: parseGeoHeader(c.req.header('X-Visitor-Geo')),
    ipSalt: c.env.JWT_SECRET,
  }
  // 后台写入，立即返回，不拖慢网站
  c.executionCtx.waitUntil(ingestEvents(c.env.DB, site, payload, ctx).catch((err) => console.error('[tracking] ingest failed:', err)))
  return c.body(null, 204)
})

export const trackingSitesAdminRoutes = new Hono<{ Bindings: Env }>()
trackingSitesAdminRoutes.use('*', requireAuth, requireAdmin)

trackingSitesAdminRoutes.get('/', async (c) => c.json({ data: await listSites(c.env.DB) }))

// 网站接入代码模板（转发代码、脚本标签）
trackingSitesAdminRoutes.get('/integration', (c) => c.json({ data: integrationTemplates() }))

trackingSitesAdminRoutes.post('/', zValidator('json', z.object({
  name: z.string().min(1, '请填写站点名称').max(50),
  domain: z.string().max(200).nullable().optional(),
})), async (c) => {
  const data = await createSite(c.env.DB, c.get('jwtPayload').userId, c.req.valid('json'))
  return c.json({ data }, 201)
})

trackingSitesAdminRoutes.patch('/:id', zValidator('json', z.object({
  name: z.string().max(50).optional(),
  domain: z.string().max(200).nullable().optional(),
  isActive: z.boolean().optional(),
})), async (c) => {
  await updateSite(c.env.DB, c.req.param('id'), c.req.valid('json'))
  return c.json({ data: { success: true } })
})

// 接入检测：从服务器端访问网站的 /_t/*；首次填写的域名会保存到站点
trackingSitesAdminRoutes.post('/:id/check', zValidator('json', z.object({
  domain: z.string().max(200).optional(),
})), async (c) => {
  const site = await getSite(c.env.DB, c.req.param('id'))
  const input = c.req.valid('json').domain || site.domain
  if (!input) return c.json({ message: '请填写网站域名' }, 400)
  const host = normalizeHost(input)
  if (host !== site.domain) await updateSite(c.env.DB, site.id, { domain: host })
  return c.json({ data: await checkSiteIntegration(site, host) })
})

trackingSitesAdminRoutes.post('/:id/rotate-key', async (c) => c.json({ data: await rotateSiteKey(c.env.DB, c.req.param('id')) }))

export const trackingRoutes = new Hono<{ Bindings: Env }>()
trackingRoutes.use('*', requireAuth, requireNotSales)

// 运营也需要选择站点（只返回名称等基本信息，不含密钥）
trackingRoutes.get('/sites', async (c) => {
  const sites = await listSites(c.env.DB)
  return c.json({ data: sites.map(({ id, name, domain, isActive, visitorCount, lastSeenAt }) => ({ id, name, domain, isActive, visitorCount, lastSeenAt })) })
})

trackingRoutes.get('/visitors', async (c) => {
  const q = c.req.query()
  return c.json(await listVisitors(c.env.DB, {
    siteId: q.siteId ?? '',
    channel: q.channel || undefined,
    withLead: q.withLead === 'true' ? true : q.withLead === 'false' ? false : undefined,
    page: Number(q.page) || 1,
    pageSize: Number(q.pageSize) || 30,
  }))
})

trackingRoutes.get('/visitors/:siteId/:visitorId', async (c) =>
  c.json({ data: await getVisitorJourney(c.env.DB, c.req.param('siteId'), c.req.param('visitorId')) }))
