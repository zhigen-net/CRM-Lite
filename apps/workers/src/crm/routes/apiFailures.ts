import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireAuth, requireAdmin } from '../middleware/auth'
import { toCamelList } from '../../shared/db'
import { actorFromJwt } from '../../domain/actor'
import { createLead } from '../../domain/leads/service'
import { normalizeExternalLead } from '../../domain/leads/intake'

export const apiFailuresRoutes = new Hono<{ Bindings: Env }>()

apiFailuresRoutes.use('*', requireAuth, requireAdmin)

// GET /api/admin/api-failures?resolved=false
apiFailuresRoutes.get('/', async (c) => {
  const showResolved = c.req.query('resolved') === 'true'
  const sql = showResolved
    ? 'SELECT * FROM api_lead_failures ORDER BY created_at DESC LIMIT 200'
    : 'SELECT * FROM api_lead_failures WHERE resolved_at IS NULL ORDER BY created_at DESC'
  const results = await c.env.DB.prepare(sql).all<Record<string, unknown>>()
  return c.json({ data: toCamelList(results.results) })
})

// POST /api/admin/api-failures/:id/create-lead
// 用失败记录里的数据直接创建线索，并标记为已处理
apiFailuresRoutes.post('/:id/create-lead', async (c) => {
  const id = c.req.param('id')
  const { userId } = c.get('jwtPayload')

  const failure = await c.env.DB.prepare(
    'SELECT * FROM api_lead_failures WHERE id = ?',
  ).bind(id).first<{
    id: string; request_body: string; resolved_at: string | null
  }>()
  if (!failure) throw new HTTPException(404, { message: '记录不存在' })
  if (failure.resolved_at) throw new HTTPException(409, { message: '该记录已处理' })

  let body: Record<string, unknown>
  try {
    body = JSON.parse(failure.request_body)
  } catch {
    throw new HTTPException(422, { message: '请求体数据损坏，无法解析' })
  }

  // 与对外接口走同一套整理规则和新建流程（进入自动分配、触发"新建"类工作流）
  const input = await normalizeExternalLead(c.env.DB, body)
  const leadId = await createLead(
    { db: c.env.DB, env: c.env, waitUntil: (p: Promise<unknown>) => c.executionCtx.waitUntil(p) },
    actorFromJwt(c.get('jwtPayload'), 'web'),
    input,
  )

  await c.env.DB.prepare(
    `UPDATE api_lead_failures
     SET resolved_at = CURRENT_TIMESTAMP, resolved_by_user_id = ?, resolution = 'created_lead'
     WHERE id = ?`,
  ).bind(userId, id).run()

  return c.json({ data: { leadId } }, 201)
})

// POST /api/admin/api-failures/:id/dismiss
apiFailuresRoutes.post('/:id/dismiss', async (c) => {
  const id = c.req.param('id')
  const { userId } = c.get('jwtPayload')

  const failure = await c.env.DB.prepare(
    'SELECT id, resolved_at FROM api_lead_failures WHERE id = ?',
  ).bind(id).first<{ id: string; resolved_at: string | null }>()
  if (!failure) throw new HTTPException(404, { message: '记录不存在' })
  if (failure.resolved_at) throw new HTTPException(409, { message: '该记录已处理' })

  await c.env.DB.prepare(
    `UPDATE api_lead_failures
     SET resolved_at = CURRENT_TIMESTAMP, resolved_by_user_id = ?, resolution = 'dismissed'
     WHERE id = ?`,
  ).bind(userId, id).run()

  return c.json({ data: { success: true } })
})
