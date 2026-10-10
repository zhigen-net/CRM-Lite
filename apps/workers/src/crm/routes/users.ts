import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { hashPassword } from '../../shared/password'
import { requireAuth, requireAdmin } from '../middleware/auth'
import { toCamel, toCamelList } from '../../shared/db'

export const usersRoutes = new Hono<{ Bindings: Env }>()

usersRoutes.use('*', requireAuth, requireAdmin)

usersRoutes.get('/', async (c) => {
  const { page = '1', pageSize = '20', search } = c.req.query()
  const offset = (Number(page) - 1) * Number(pageSize)

  let where = 'WHERE 1=1'
  const params: unknown[] = []
  if (search) {
    where += ' AND (u.name LIKE ? OR u.email LIKE ?)'
    const q = `%${search}%`
    params.push(q, q)
  }

  const [results, countResult] = await Promise.all([
    c.env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.phone, u.role, u.team_id, u.capacity, u.specialization, u.current_leads_count,
        (SELECT COUNT(*) FROM clients WHERE assigned_sales_userId = u.id AND deleted_at IS NULL) as current_clients_count,
        t.name as team_name, u.is_active, u.created_at
        FROM users u LEFT JOIN teams t ON u.team_id = t.id ${where} ORDER BY u.name LIMIT ? OFFSET ?`,
    ).bind(...params, Number(pageSize), offset).all(),
    c.env.DB.prepare(`SELECT COUNT(*) as total FROM users u ${where}`)
      .bind(...params).first<{ total: number }>(),
  ])

  const users = (results.results as Record<string, unknown>[]).map((u) => {
    const camel = toCamel(u) as Record<string, unknown>
    if (typeof camel.specialization === 'string') {
      try { camel.specialization = JSON.parse(camel.specialization as string) } catch { camel.specialization = [] }
    }
    camel.specialization ??= []
    return camel
  })
  return c.json({ data: users, total: countResult?.total ?? 0, page: Number(page), pageSize: Number(pageSize) })
})

usersRoutes.put(
  '/:id',
  zValidator(
    'json',
    z.object({
      name: z.string().optional(),
      phone: z.string().nullable().optional(),
      role: z.enum(['admin', 'operations', 'sales']).optional(),
      teamId: z.string().nullable().optional(),
      capacity: z.number().int().positive().optional(),
      specialization: z.array(z.string()).optional(),
      isActive: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const id = c.req.param('id')
    const body = c.req.valid('json')

    const existing = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first()
    if (!existing) throw new HTTPException(404, { message: '用户不存在' })

    const updates: string[] = ['updated_at = CURRENT_TIMESTAMP']
    const params: unknown[] = []

    if (body.name !== undefined) { updates.push('name = ?'); params.push(body.name) }
    if (body.phone !== undefined) { updates.push('phone = ?'); params.push(body.phone) }
    if (body.role !== undefined) { updates.push('role = ?'); params.push(body.role) }
    if (body.teamId !== undefined) { updates.push('team_id = ?'); params.push(body.teamId) }
    if (body.capacity !== undefined) { updates.push('capacity = ?'); params.push(body.capacity) }
    if (body.specialization !== undefined) { updates.push('specialization = ?'); params.push(JSON.stringify(body.specialization)) }
    if (body.isActive !== undefined) { updates.push('is_active = ?'); params.push(body.isActive ? 1 : 0) }

    params.push(id)
    await c.env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run()

    const updated = await c.env.DB.prepare(
      'SELECT id, email, name, phone, role, team_id, capacity, current_leads_count, is_active FROM users WHERE id = ?',
    ).bind(id).first()
    return c.json({ data: toCamel(updated as Record<string, unknown>) })
  },
)

// 管理员重置指定用户密码（无需旧密码）
usersRoutes.put(
  '/:id/password',
  zValidator('json', z.object({ newPassword: z.string().min(8, '密码至少 8 位') })),
  async (c) => {
    const id = c.req.param('id')
    const { newPassword } = c.req.valid('json')

    const existing = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(id).first()
    if (!existing) throw new HTTPException(404, { message: '用户不存在' })

    const passwordHash = await hashPassword(newPassword)
    await c.env.DB.prepare(
      'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).bind(passwordHash, id).run()

    return c.json({ data: { success: true } })
  },
)
