// 仪表盘接口：GET /api/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD&source=（系统时区的自然日，含首尾；不传为最近 7 天；source 为线索来源，可选）
import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth'
import { actorFromJwt } from '../../domain/actor'
import { getDashboard } from '../../domain/dashboard/service'
import { resolveRange, systemTimezone } from '../../domain/timeRange'

export const dashboardRoutes = new Hono<{ Bindings: Env }>()
dashboardRoutes.use('*', requireAuth)

dashboardRoutes.get('/', async (c) => {
  const tz = await systemTimezone(c.env.DB)
  const range = resolveRange(tz, c.req.query('from'), c.req.query('to'))
  return c.json({ data: await getDashboard(c.env.DB, actorFromJwt(c.get('jwtPayload'), 'web'), range, tz, c.req.query('source')?.slice(0, 200)) })
})
