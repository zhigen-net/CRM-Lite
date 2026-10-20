import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireAuth, requireAdmin } from '../middleware/auth'
import { toCamelList } from '../../shared/db'
import { actorFromJwt, depsFrom } from '../../domain/actor'
import { submitExternalLead } from '../../domain/leads/submit'

export const apiFailuresRoutes = new Hono<{ Bindings: Env }>()

apiFailuresRoutes.use('*', requireAuth, requireAdmin)

// GET /api/admin/api-failures?resolved=false
apiFailuresRoutes.get('/', async (c) => {
  const showResolved = c.req.query('resolved') === 'true'
  // 来源：网站表单记站点，对外接口记 API Key 前缀
  const base = 'SELECT f.*, s.name AS site_name FROM api_lead_failures f LEFT JOIN tracking_sites s ON s.id = f.site_id'
  const sql = showResolved
    ? `${base} ORDER BY f.created_at DESC LIMIT 200`
    : `${base} WHERE f.resolved_at IS NULL ORDER BY f.created_at DESC`
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

  // 与对外接口、网站表单同一套处理（进入自动分配、触发"新建"类工作流）；补录失败不再新增失败记录
  const { id: leadId } = await submitExternalLead(depsFrom(c), actorFromJwt(c.get('jwtPayload'), 'web'), body)

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
