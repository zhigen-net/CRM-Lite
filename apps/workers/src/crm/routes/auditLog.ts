// 操作记录查看（仅管理员）：所有入口的操作，见 domain/operationLog.ts
import { Hono } from 'hono'
import { requireAuth, requireAdmin } from '../middleware/auth'
import { listOperations } from '../../domain/operationLog'
import { resolveRange, systemTimezone } from '../../domain/timeRange'

export const auditLogRoutes = new Hono<{ Bindings: Env }>()

auditLogRoutes.use('*', requireAuth, requireAdmin)

// GET /api/admin/audit-log?from=&to=&userId=&via=&category=&status=&targetId=&q=&page=&pageSize=
// from / to 为系统时区的日期（YYYY-MM-DD），都不传时不限时间
auditLogRoutes.get('/', async (c) => {
  const q = c.req.query()
  const page = Math.max(1, Number(q.page ?? 1) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 50) || 50))
  const range = q.from || q.to ? resolveRange(await systemTimezone(c.env.DB), q.from, q.to ?? q.from) : null
  const text = (v: string | undefined, max = 100) => (v ? v.slice(0, max) : undefined)
  return c.json(await listOperations(c.env.DB, {
    from: range?.startUtc, to: range?.endUtc,
    userId: text(q.userId), via: text(q.via, 20), category: text(q.category, 30), status: text(q.status, 10),
    targetId: text(q.targetId), q: text(q.q), page, pageSize,
  }))
})
