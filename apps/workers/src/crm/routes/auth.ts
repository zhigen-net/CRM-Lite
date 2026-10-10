import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { hashPassword, verifyPassword } from '../../shared/password'
import { v4 as uuidv4 } from 'uuid'
import { signCrmJwt } from '../../shared/jwt'
import { requireAuth, requireAdmin } from '../middleware/auth'
import { buildWebhookPayload } from '../../notification/handler'
// sendEmail 通过 buildWebhookPayload 同文件引入，此处不需要重复导入

export const authRoutes = new Hono<{ Bindings: Env }>()

authRoutes.post(
  '/login',
  zValidator('json', z.object({ email: z.string().email(), password: z.string().min(1) })),
  async (c) => {
    const { email, password } = c.req.valid('json')

    const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<{
      id: string; email: string; password_hash: string; name: string; role: string; team_id: string | null; is_active: number
    }>()

    const check = user ? await verifyPassword(password, user.password_hash) : null
    if (!user || !check?.valid) {
      throw new HTTPException(401, { message: '邮箱或密码错误' })
    }

    if (!user.is_active) {
      throw new HTTPException(403, { message: '账号已被禁用，请联系管理员' })
    }

    // 旧格式（bcrypt）或迭代次数变化：登录成功后自动升级哈希
    if (check.needsRehash) {
      await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .bind(await hashPassword(password), user.id).run()
    }

    const token = await signCrmJwt(
      { userId: user.id, role: user.role as 'admin' | 'operations' | 'sales', teamId: user.team_id },
      c.env.JWT_SECRET,
    )

    return c.json({ data: { token, user: { id: user.id, email: user.email, name: user.name, role: user.role, teamId: user.team_id } } })
  },
)

authRoutes.get('/me', requireAuth, async (c) => {
  const { userId } = c.get('jwtPayload')
  const row = await c.env.DB.prepare(
    'SELECT id, email, name, role, team_id, capacity, specialization, current_leads_count, created_at FROM users WHERE id = ?',
  ).bind(userId).first<Record<string, unknown>>()
  if (!row) throw new HTTPException(404, { message: '用户不存在' })
  const { toCamel } = await import('../../shared/db')
  const user = toCamel(row) as Record<string, unknown>
  if (typeof user.specialization === 'string') {
    try { user.specialization = JSON.parse(user.specialization as string) } catch { user.specialization = [] }
  }
  user.specialization ??= []
  return c.json({ data: user })
})

authRoutes.put(
  '/profile',
  requireAuth,
  zValidator(
    'json',
    z.object({
      name: z.string().min(1).optional(),
      currentPassword: z.string().optional(),
      newPassword: z.string().min(8).optional(),
    }),
  ),
  async (c) => {
    const { userId } = c.get('jwtPayload')
    const body = c.req.valid('json')

    const user = await c.env.DB.prepare('SELECT id, password_hash FROM users WHERE id = ?')
      .bind(userId)
      .first<{ id: string; password_hash: string }>()
    if (!user) throw new HTTPException(404, { message: '用户不存在' })

    const updates: string[] = ['updated_at = CURRENT_TIMESTAMP']
    const params: unknown[] = []

    if (body.name !== undefined) {
      updates.push('name = ?')
      params.push(body.name)
    }

    if (body.newPassword !== undefined) {
      if (!body.currentPassword) {
        throw new HTTPException(400, { message: '请输入当前密码' })
      }
      const { valid } = await verifyPassword(body.currentPassword, user.password_hash)
      if (!valid) throw new HTTPException(400, { message: '当前密码错误' })
      updates.push('password_hash = ?')
      params.push(await hashPassword(body.newPassword))
    }

    if (params.length === 0) return c.json({ data: { success: true } })

    params.push(userId)
    await c.env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...params)
      .run()

    const updated = await c.env.DB.prepare(
      'SELECT id, email, name, role, team_id FROM users WHERE id = ?',
    ).bind(userId).first()
    return c.json({ data: updated })
  },
)

authRoutes.get('/notification-config', requireAuth, async (c) => {
  const { userId } = c.get('jwtPayload')
  const row = await c.env.DB.prepare('SELECT notification_config, email FROM users WHERE id = ?')
    .bind(userId).first<{ notification_config: string | null; email: string }>()
  const defaultEmail = row?.email ?? ''
  let config = { emailEnabled: false, email: defaultEmail, webhookEnabled: false, webhookUrl: '' }
  if (row?.notification_config) {
    try { config = { ...config, ...JSON.parse(row.notification_config) } } catch { /* keep default */ }
  }
  return c.json({ data: config })
})

authRoutes.put(
  '/notification-config',
  requireAuth,
  zValidator('json', z.object({
    emailEnabled: z.boolean(),
    email: z.string().optional().default(''),
    webhookEnabled: z.boolean(),
    webhookUrl: z.string().optional().default(''),
  })),
  async (c) => {
    const { userId } = c.get('jwtPayload')
    const body = c.req.valid('json')
    await c.env.DB.prepare('UPDATE users SET notification_config = ? WHERE id = ?')
      .bind(JSON.stringify(body), userId).run()
    return c.json({ data: body })
  },
)

authRoutes.post(
  '/notification-config/test-webhook',
  requireAuth,
  zValidator('json', z.object({ webhookUrl: z.string().url('请填写有效的 URL') })),
  async (c) => {
    const { webhookUrl } = c.req.valid('json')
    const { userId } = c.get('jwtPayload')
    const user = await c.env.DB.prepare('SELECT name FROM users WHERE id = ?')
      .bind(userId).first<{ name: string }>()
    try {
      const testText = `【CRM 测试消息】来自 ${user?.name ?? '未知'} 的 Webhook 连通性测试`
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildWebhookPayload(webhookUrl, testText)),
      })
      const responseText = await res.text().catch(() => '')
      return c.json({ data: { ok: res.ok, status: res.status, body: responseText } })
    } catch (err) {
      return c.json({ data: { ok: false, status: 0, body: String(err) } })
    }
  },
)

authRoutes.post(
  '/register',
  requireAuth,
  requireAdmin,
  zValidator('json', z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1),
    phone: z.string().nullable().optional(),
    role: z.enum(['admin', 'operations', 'sales']),
    teamId: z.string().nullable().optional(),
  })),
  async (c) => {
    const { email, password, name, phone, role, teamId } = c.req.valid('json')
    const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
    if (existing) throw new HTTPException(409, { message: '邮箱已存在' })

    const passwordHash = await hashPassword(password)
    const id = uuidv4()
    await c.env.DB.prepare(
      'INSERT INTO users (id, email, password_hash, name, phone, role, team_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, email, passwordHash, name, phone ?? null, role, teamId ?? null).run()

    return c.json({ data: { id, email, name, role } }, 201)
  },
)
