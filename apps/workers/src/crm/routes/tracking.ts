// 访客统计接口
// - /api/t/*：网站服务器端转发的采集请求（站点密钥鉴权，不开放跨域，不信任浏览器传来的 IP）
// - /api/admin/tracking-sites：站点管理（管理员）
// - /api/tracking/*：访客数据查询（管理员、运营）
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAdmin, requireAuth, requireNotSales } from '../middleware/auth'
import { TRACKER_SCRIPT } from '../../domain/tracking/script'
import { findSiteByKey, getSite, listSiteSubmissions, listSites, createSite, updateSite, rotateSiteKey } from '../../domain/tracking/sites'
import { ingestEvents, parseGeoHeader, type CollectPayload } from '../../domain/tracking/ingest'
import { getVisitorJourney, listVisitors } from '../../domain/tracking/queries'
import { integrationTemplates } from '../../domain/tracking/integration'
import { checkSiteIntegration, normalizeHost } from '../../domain/tracking/check'
import { submitSiteLead, type SiteLeadResult } from '../../domain/tracking/siteLead'
import { depsFrom } from '../../domain/actor'

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

// ─── 网站表单留资（/_t/lead 转发而来）────────────────────────────────────────
// 与 /api/v1/leads 共用 submitExternalLead；这里只解析浏览器表单并按提交方式返回 JSON 或提示页面

/** 解析 JSON、普通表单、multipart 表单（文件字段忽略） */
async function parseLeadBody(contentType: string, buf: ArrayBuffer): Promise<Record<string, unknown> | null> {
  const text = new TextDecoder().decode(buf)
  if (contentType.includes('application/json')) {
    try {
      const v = JSON.parse(text) as unknown
      return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
    } catch { return null }
  }
  const out: Record<string, unknown> = {}
  if (contentType.includes('multipart/form-data')) {
    const fd = await new Response(buf, { headers: { 'Content-Type': contentType } }).formData().catch(() => null)
    if (!fd) return null
    fd.forEach((v, k) => { if (typeof v === 'string') out[k] = v })
    return out
  }
  new URLSearchParams(text).forEach((v, k) => { out[k] = v })
  return out
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)

/** 原生表单提交后的提示页：成功时可跳转到网站指定的站内路径（_redirect） */
function leadHtml(result: SiteLeadResult, redirect: string | null) {
  const ok = result.status === 'ok' || result.status === 'spam'
  const msg = ok ? '提交成功，我们会尽快与您联系。' : (result.message ?? '提交失败，请稍后再试。')
  const go = ok && redirect ? `<meta http-equiv="refresh" content="2;url=${escapeHtml(redirect)}">` : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${go}
<title>${ok ? '提交成功' : '提交失败'}</title></head>
<body style="font-family:system-ui,sans-serif;display:flex;min-height:90vh;align-items:center;justify-content:center;color:#111">
<div style="text-align:center;max-width:360px;padding:24px"><p style="font-size:18px">${escapeHtml(msg)}</p>
<p><a href="${escapeHtml(redirect ?? '/')}" style="color:#0284c7">${ok && redirect ? '正在返回…' : '返回首页'}</a></p></div></body></html>`
}

trackingCollectRoutes.post('/lead', async (c) => {
  const site = await findSiteByKey(c.env.DB, c.req.header('X-Site-Key'))
  if (!site) return c.json({ ok: false, message: '站点密钥无效或站点已停用' }, 401)
  const buf = await c.req.arrayBuffer()
  if (buf.byteLength > MAX_BODY_BYTES) return c.json({ ok: false, message: '请求过大' }, 413)
  const contentType = c.req.header('Content-Type') ?? ''
  const raw = await parseLeadBody(contentType, buf)
  if (!raw) return c.json({ ok: false, message: '请求格式错误' }, 400)
  // 接入检测的探测请求：只回报密钥对应的站点，不建线索、不计入提交频率
  if ('ping' in raw) return c.json({ data: { siteId: site.id } })

  const result = await submitSiteLead(depsFrom(c), { id: site.id, name: site.name, ownerId: site.ownerId ?? null }, raw, {
    geo: parseGeoHeader(c.req.header('X-Visitor-Geo')), ipSalt: c.env.JWT_SECRET,
  })
  const status = result.status === 'ok' || result.status === 'spam' ? 200
    : result.status === 'rate_limited' ? 429 : result.status === 'invalid' ? 400 : 503

  // JS 提交（JSON 或 _format=json）返回 JSON；原生表单返回提示页面
  if (contentType.includes('application/json') || raw._format === 'json') {
    return c.json(status === 200 ? { ok: true } : { ok: false, message: result.message }, status)
  }
  const redirect = typeof raw._redirect === 'string' && /^\/(?!\/)/.test(raw._redirect) ? raw._redirect.slice(0, 300) : null
  return c.html(leadHtml(result, redirect), status)
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

// 最近的表单提交记录（含被拦截的）
trackingSitesAdminRoutes.get('/:id/submissions', async (c) => c.json({ data: await listSiteSubmissions(c.env.DB, c.req.param('id')) }))

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
