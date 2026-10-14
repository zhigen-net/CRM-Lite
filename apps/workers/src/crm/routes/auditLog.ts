// 审计日志查看（仅管理员）：对外接口、AI 助手、MCP 的调用记录
import { Hono } from 'hono'
import { requireAuth, requireAdmin } from '../middleware/auth'
import { toCamelList } from '../../shared/db'

export const auditLogRoutes = new Hono<{ Bindings: Env }>()

auditLogRoutes.use('*', requireAuth, requireAdmin)

// GET /api/admin/audit-log?via=&status=&action=&userId=&page=&pageSize=
auditLogRoutes.get('/', async (c) => {
  const q = c.req.query()
  const page = Math.max(1, Number(q.page ?? 1) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 50) || 50))

  let where = 'WHERE 1=1'
  const params: unknown[] = []
  for (const [key, col] of [['via', 'al.via'], ['status', 'al.status'], ['action', 'al.action'], ['userId', 'al.user_id']] as const) {
    if (q[key]) { where += ` AND ${col} = ?`; params.push(q[key]) }
  }

  const [count, rows] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS total FROM audit_log al ${where}`).bind(...params).first<{ total: number }>(),
    c.env.DB.prepare(`
      SELECT al.*, u.name AS user_name, ak.name AS api_key_name, ak.key_prefix AS api_key_prefix
      FROM audit_log al
      LEFT JOIN users u ON al.user_id = u.id
      LEFT JOIN api_keys ak ON al.api_key_id = ak.id
      ${where} ORDER BY al.created_at DESC LIMIT ? OFFSET ?`,
    ).bind(...params, pageSize, (page - 1) * pageSize).all<Record<string, unknown>>(),
  ])
  return c.json({ data: toCamelList(rows.results), total: count?.total ?? 0, page, pageSize })
})
