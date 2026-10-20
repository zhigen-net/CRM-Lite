import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { HTTPException } from 'hono/http-exception'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'

// CRM 内部路由
import { authRoutes } from './crm/routes/auth'
import { leadsRoutes } from './crm/routes/leads'
import { clientsRoutes } from './crm/routes/clients'
import { servicesRoutes } from './crm/routes/services'
import { partnersRoutes } from './crm/routes/partners'
import { partnerProductsRoutes } from './crm/routes/partnerProducts'
import { activitiesRoutes } from './crm/routes/activities'
import { usersRoutes } from './crm/routes/users'
import { teamsRoutes } from './crm/routes/teams'
import { uploadRoutes } from './crm/routes/upload'
import { settingsRoutes } from './crm/routes/settings'
import { optionsRoutes } from './crm/routes/options'
import { apiKeysRoutes } from './crm/routes/apiKeys'
import { assignmentRulesRoutes } from './crm/routes/assignmentRules'
import { aiConfigRoutes } from './crm/routes/aiConfig'
import { aiAgentRoutes } from './crm/routes/aiAgent'
import { workflowsRoutes, workflowsAdminRoutes } from './crm/routes/workflows'
import { entitySchemaRoutes } from './crm/routes/entitySchema'
import { recycleBinRoutes } from './crm/routes/recycleBin'
import { apiFailuresRoutes } from './crm/routes/apiFailures'
import { milestonesRoutes } from './crm/routes/milestones'
import { v1DocsRoutes } from './crm/routes/v1Docs'
import { auditLogRoutes } from './crm/routes/auditLog'
import { mcpRoutes } from './crm/routes/mcp'
import { trackingCollectRoutes, trackingRoutes, trackingSitesAdminRoutes } from './crm/routes/tracking'
import { requireApiKey, requireScope } from './crm/middleware/apiKeyAuth'
import { executeScheduledWorkflows } from './crm/workflow/executor'
import { hashPassword } from './shared/password'
import { actorFromJwt, depsFrom } from './domain/actor'
import { DomainError } from './domain/errors'
import { prepareExternalLead, submitExternalLead } from './domain/leads/submit'
import { applyIndustryTemplate, INDUSTRY_TEMPLATES } from './domain/templates'

// 客户门户路由
import { portalAuthRoutes } from './portal/routes/auth'
import { profileRoutes } from './portal/routes/profile'
import { servicesRoutes as portalServicesRoutes } from './portal/routes/services'
import { resourcesRoutes } from './portal/routes/resources'
import { portalMilestonesRoutes } from './portal/routes/milestones'

// 线索分配 Queue 消费逻辑
import { handleLeadAssignmentBatch } from './assignment/handler'
import { handleNotificationBatch } from './notification/handler'

const app = new Hono<{ Bindings: Env }>()

app.use('*', logger())

// 让 CDN 按 Origin 分别缓存，避免无 CORS 头的响应被其他 origin 命中
app.use('*', async (c, next) => {
  await next()
  c.res.headers.set('Vary', 'Origin')
})

// 外部 API 的 CORS 必须在全局 CORS 之前注册，否则预检请求被全局中间件拦截
app.use('/api/v1/*', cors({ origin: '*' }))

app.use(
  '*',
  cors({
    origin: (origin) => {
      // 允许本地开发
      if (origin === 'http://localhost:5173') return origin
      // 允许所有 Cloudflare Pages 域名（含 fork 部署）
      if (origin?.endsWith('.pages.dev')) return origin
      // 允许阿里云 ESA Pages 子域名
      if (origin?.endsWith('.esapages.com')) return origin
      if (origin?.endsWith('.er.aliyun-esa.net')) return origin
      // 允许 zhigen.net 和 ybivf.com 所有子域名
      if (origin?.endsWith('.zhigen.net')) return origin
      if (origin?.endsWith('.ybivf.com')) return origin
      return null
    },
    credentials: true,
  }),
)

// 公开选项接口（无需登录）
app.route('/api/options', optionsRoutes)

// 公开接口（无需登录）
app.get('/api/public/setup-required', async (c) => {
  const row = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM users').first<{ cnt: number }>()
  return c.json({ data: { required: (row?.cnt ?? 0) === 0 } })
})

app.post('/api/public/setup', zValidator('json', z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  // 行业模板：blank = 通用（清除内置的行业示例数据），fertility = 辅助生殖
  template: z.enum(INDUSTRY_TEMPLATES).default('blank'),
})), async (c) => {
  const row = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM users').first<{ cnt: number }>()
  if ((row?.cnt ?? 0) > 0) {
    return c.json({ message: '系统已完成初始化' }, 403)
  }
  const { name, email, password, template } = c.req.valid('json')
  // 先应用模板再建管理员：模板失败时可以重新初始化
  await applyIndustryTemplate(c.env.DB, template)
  const passwordHash = await hashPassword(password)
  const id = uuidv4()
  await c.env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)',
  ).bind(id, email, passwordHash, name, 'admin').run()
  return c.json({ data: { id, email, name, role: 'admin' } }, 201)
})

app.get('/api/public/settings', async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT key, value FROM system_settings WHERE key IN ('system_name', 'timezone', 'ai_agent_enabled', 'portal_enabled')",
  ).all<{ key: string; value: string }>()
  const map = Object.fromEntries(rows.results.map((r) => [r.key, r.value]))
  return c.json({
    data: {
      systemName: map['system_name'] || null,  // 未设置时前端显示产品名
      timezone: map['timezone'] ?? 'Asia/Shanghai',
      aiAgentEnabled: map['ai_agent_enabled'] !== 'false',
      // 客户门户默认关闭，管理员在「系统设置 → 基本设置」开启
      portalEnabled: map['portal_enabled'] === 'true',
    },
  })
})

// 对外接口说明（无需鉴权）
app.route('/api/v1', v1DocsRoutes)

// MCP 服务（API Key 鉴权）
app.route('/api/mcp', mcpRoutes)

// 访客统计采集（网站服务器端转发，站点密钥鉴权）
app.route('/api/t', trackingCollectRoutes)

// 对外接口新建线索：鉴权在这里，校验、整理、新建、审计、失败记录都在 domain/leads/submit.ts（与网站表单 /api/t/lead 共用）
app.post('/api/v1/leads', requireApiKey, requireScope('leads:create'), async (c) => {
  const body = await c.req.json<unknown>().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ message: '请求体必须是 JSON 对象' }, 400)
  const actor = actorFromJwt(c.get('jwtPayload'), 'api', c.get('apiKey').id)
  // 试运行：只返回整理后的结果，不建线索、不记失败
  if (['1', 'true'].includes(c.req.query('dryRun') ?? '')) {
    return c.json({ data: { dryRun: true, lead: await prepareExternalLead(c.env.DB, body as Record<string, unknown>) } })
  }
  const { id, duplicate } = await submitExternalLead(depsFrom(c), actor, body as Record<string, unknown>, {
    audit: true, failure: { apiKeyPrefix: (c.req.header('X-API-Key') ?? '').slice(0, 12) || null },
  })
  // 30 天内同一联系方式已有线索：已合并到该线索，返回 200 与已有线索 ID
  if (duplicate) return c.json({ data: { id, duplicate: true } }, 200)
  return c.json({ data: { id, status: 'New' } }, 201)
})

// CRM 内部 API（/api/*）
app.route('/api/auth', authRoutes)
app.route('/api/leads', leadsRoutes)
app.route('/api/clients', clientsRoutes)
app.route('/api/services', servicesRoutes)
app.route('/api/partners', partnersRoutes)
app.route('/api/partner-products', partnerProductsRoutes)
app.route('/api/activities', activitiesRoutes)
app.route('/api/users', usersRoutes)
app.route('/api/teams', teamsRoutes)
app.route('/api/upload', uploadRoutes)
app.route('/api/admin/settings', settingsRoutes)
app.route('/api/admin/options', optionsRoutes)
app.route('/api/admin/assignment-rules', assignmentRulesRoutes)
app.route('/api/admin/ai', aiConfigRoutes)
app.route('/api', aiAgentRoutes)
app.route('/api/auth/api-keys', apiKeysRoutes)
app.route('/api/workflows', workflowsRoutes)
app.route('/api/admin/workflows', workflowsAdminRoutes)
app.route('/api/admin/entity-schema', entitySchemaRoutes)
app.route('/api/admin/recycle-bin', recycleBinRoutes)
app.route('/api/admin/api-failures', apiFailuresRoutes)
app.route('/api/admin/audit-log', auditLogRoutes)
app.route('/api/admin/tracking-sites', trackingSitesAdminRoutes)
app.route('/api/tracking', trackingRoutes)
app.route('/api/milestones', milestonesRoutes)

// 客户门户 API（/api/client/*）：默认关闭，未开启时一律 404
app.use('/api/client/*', async (c, next) => {
  const row = await c.env.DB.prepare("SELECT value FROM system_settings WHERE key = 'portal_enabled'").first<{ value: string }>()
  if (row?.value !== 'true') return c.json({ message: '客户门户未开启' }, 404)
  return next()
})
app.route('/api/client/auth', portalAuthRoutes)
app.route('/api/client/profile', profileRoutes)
app.route('/api/client/services', portalServicesRoutes)
app.route('/api/client/resources', resourcesRoutes)
app.route('/api/client/milestones', portalMilestonesRoutes)

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ message: err.message }, err.status)
  }
  if (err instanceof DomainError) {
    return c.json({ message: err.message }, err.status)
  }
  console.error(err)
  return c.json({ message: '服务器内部错误' }, 500)
})

app.notFound((c) => c.json({ message: '接口不存在' }, 404))

// 同时导出 fetch handler（HTTP 请求）、queue handler（异步队列）和 scheduled（Cron）
export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<{ leadId: string } | { type: string; leadId: string; assignedToUserId: string }>, env: Env): Promise<void> {
    // 队列名由部署脚本生成：<worker名>-leads / <worker名>-notify
    if (batch.queue.endsWith('-notify')) {
      await handleNotificationBatch(batch as MessageBatch<{ type: 'lead_assigned'; leadId: string; assignedToUserId: string }>, env)
    } else {
      await handleLeadAssignmentBatch(batch as MessageBatch<{ leadId: string }>, env)
    }
  },
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      executeScheduledWorkflows(env.DB, env)
        .catch((err) => console.error('[workflow/scheduled] cron error:', err)),
    )
  },
}
