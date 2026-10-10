import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import { signPortalJwt } from '../../shared/jwt'
import { requirePortalAuth } from '../middleware/auth'
import { sendEmail } from '../../shared/email'

export const portalAuthRoutes = new Hono<{ Bindings: Env }>()

portalAuthRoutes.post(
  '/login',
  zValidator('json', z.object({ email: z.string().email(), password: z.string().min(1) })),
  async (c) => {
    const { email, password } = c.req.valid('json')

    const clientUser = await c.env.DB.prepare('SELECT * FROM client_users WHERE email = ?')
      .bind(email)
      .first<{ id: string; client_id: string; email: string; password_hash: string | null }>()

    if (!clientUser?.password_hash || !(await bcrypt.compare(password, clientUser.password_hash))) {
      throw new HTTPException(401, { message: '邮箱或密码错误' })
    }

    await c.env.DB.prepare(
      'UPDATE client_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).bind(clientUser.id).run()

    const token = await signPortalJwt(
      { clientUserId: clientUser.id, clientId: clientUser.client_id },
      c.env.PORTAL_JWT_SECRET,
    )

    return c.json({
      data: { token, clientUser: { id: clientUser.id, clientId: clientUser.client_id, email: clientUser.email } },
    })
  },
)

portalAuthRoutes.post(
  '/magiclink',
  zValidator('json', z.object({ email: z.string().email() })),
  async (c) => {
    const { email } = c.req.valid('json')

    const clientUser = await c.env.DB.prepare('SELECT id FROM client_users WHERE email = ?')
      .bind(email)
      .first<{ id: string }>()

    if (!clientUser) return c.json({ data: { message: '如果邮箱存在，登录链接已发送' } })

    const token = uuidv4()
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()

    await c.env.DB.prepare(
      'UPDATE client_users SET magic_link_token = ?, magic_link_expires_at = ? WHERE id = ?',
    ).bind(token, expiresAt, clientUser.id).run()

    // 未配置 PORTAL_BASE_URL 时使用当前访问域名（前端与 API 同源）
    const baseUrl = c.env.PORTAL_BASE_URL || new URL(c.req.url).origin
    const magicLink = `${baseUrl}/portal/login?token=${token}`

    await sendEmail(
      c.env,
      email,
      '您的登录链接',
      `<p>请点击以下链接登录（15分钟内有效）：</p><p><a href="${magicLink}">${magicLink}</a></p>`,
      { html: true },
    )

    return c.json({ data: { message: '如果邮箱存在，登录链接已发送' } })
  },
)

portalAuthRoutes.post(
  '/magiclink/verify',
  zValidator('json', z.object({ token: z.string() })),
  async (c) => {
    const { token } = c.req.valid('json')

    const clientUser = await c.env.DB.prepare(
      `SELECT * FROM client_users WHERE magic_link_token = ? AND magic_link_expires_at > datetime('now')`,
    ).bind(token).first<{ id: string; client_id: string; email: string }>()

    if (!clientUser) throw new HTTPException(401, { message: '链接无效或已过期' })

    await c.env.DB.prepare(
      'UPDATE client_users SET magic_link_token = NULL, magic_link_expires_at = NULL, last_login_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).bind(clientUser.id).run()

    const jwtToken = await signPortalJwt(
      { clientUserId: clientUser.id, clientId: clientUser.client_id },
      c.env.PORTAL_JWT_SECRET,
    )

    return c.json({
      data: { token: jwtToken, clientUser: { id: clientUser.id, clientId: clientUser.client_id, email: clientUser.email } },
    })
  },
)

portalAuthRoutes.get('/me', requirePortalAuth, async (c) => {
  const { clientUserId } = c.get('portalPayload')
  const clientUser = await c.env.DB.prepare(
    'SELECT id, client_id, email, last_login_at FROM client_users WHERE id = ?',
  ).bind(clientUserId).first()
  if (!clientUser) throw new HTTPException(404, { message: '用户不存在' })
  return c.json({ data: clientUser })
})
