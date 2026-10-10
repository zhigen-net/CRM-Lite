import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { hashPassword, verifyPassword } from '../../shared/password'
import { requirePortalAuth } from '../middleware/auth'
import { toCamel } from '../../shared/db'

export const profileRoutes = new Hono<{ Bindings: Env }>()

profileRoutes.use('*', requirePortalAuth)

profileRoutes.get('/', async (c) => {
  const { clientId } = c.get('portalPayload')
  const client = await c.env.DB.prepare(
    'SELECT id, name, email, phone, service_plan, service_plans, contract_status, created_at FROM clients WHERE id = ?',
  ).bind(clientId).first()

  if (!client) throw new HTTPException(404, { message: '客户信息不存在' })
  const result = toCamel(client as Record<string, unknown>) as Record<string, unknown>
  if (typeof result.servicePlans === 'string') {
    try { result.servicePlans = JSON.parse(result.servicePlans as string) } catch { result.servicePlans = [] }
  }
  return c.json({ data: result })
})

profileRoutes.put(
  '/',
  zValidator('json', z.object({
    phone: z.string().nullable().optional(),
    name: z.string().min(1).optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8).optional(),
  })),
  async (c) => {
    const { clientId, clientUserId } = c.get('portalPayload')
    const body = c.req.valid('json')

    // 更新 clients 表（name、phone）
    const clientUpdates: string[] = ['updated_at = CURRENT_TIMESTAMP']
    const clientParams: unknown[] = []

    if (body.phone !== undefined) {
      clientUpdates.push('phone = ?')
      clientParams.push(body.phone)
    }
    if (body.name !== undefined) {
      clientUpdates.push('name = ?')
      clientParams.push(body.name)
    }

    if (clientParams.length > 0) {
      clientParams.push(clientId)
      await c.env.DB.prepare(`UPDATE clients SET ${clientUpdates.join(', ')} WHERE id = ?`)
        .bind(...clientParams).run()
    }

    // 修改密码（client_users 表）
    if (body.newPassword !== undefined) {
      if (!body.currentPassword) {
        throw new HTTPException(400, { message: '请输入当前密码' })
      }
      const clientUser = await c.env.DB.prepare('SELECT password_hash FROM client_users WHERE id = ?')
        .bind(clientUserId).first<{ password_hash: string | null }>()
      if (!clientUser?.password_hash) {
        throw new HTTPException(400, { message: '当前账户未设置密码，无法通过此方式修改' })
      }
      const { valid } = await verifyPassword(body.currentPassword, clientUser.password_hash)
      if (!valid) throw new HTTPException(400, { message: '当前密码错误' })
      const newHash = await hashPassword(body.newPassword)
      await c.env.DB.prepare(
        'UPDATE client_users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ).bind(newHash, clientUserId).run()
    }

    const updated = await c.env.DB.prepare(
      'SELECT id, name, email, phone, service_plan, contract_status FROM clients WHERE id = ?',
    ).bind(clientId).first()
    return c.json({ data: toCamel(updated as Record<string, unknown>) })
  },
)
