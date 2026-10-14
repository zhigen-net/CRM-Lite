import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { v4 as uuidv4 } from 'uuid'
import { requireAuth } from '../middleware/auth'
import { toCamelList } from '../../shared/db'
import { SCOPES } from '../../domain/capabilities'
import { parseScopes } from '../middleware/apiKeyAuth'

export const apiKeysRoutes = new Hono<{ Bindings: Env }>()

apiKeysRoutes.use('*', requireAuth)

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// GET /api/auth/api-keys - 获取当前用户的所有 API Key
apiKeysRoutes.get('/', async (c) => {
  const { userId } = c.get('jwtPayload')
  const results = await c.env.DB.prepare(
    'SELECT id, name, key_prefix, scopes, created_at, last_used_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC',
  ).bind(userId).all<Record<string, unknown>>()
  const data = toCamelList(results.results).map((k) => ({ ...k, scopes: parseScopes(k.scopes as string | null) }))
  return c.json({ data })
})

// POST /api/auth/api-keys - 生成新 API Key（明文只返回一次）
apiKeysRoutes.post(
  '/',
  zValidator('json', z.object({
    name: z.string().min(1, '请填写名称').max(50),
    // 不传时只授予推送线索，与旧版行为一致
    scopes: z.array(z.enum(SCOPES)).min(1, '请至少选择一项权限').optional(),
  })),
  async (c) => {
    const { userId } = c.get('jwtPayload')
    const { name, scopes: requested } = c.req.valid('json')
    const scopes = [...new Set(requested ?? ['leads:create'])]

    // 生成 crm_ 前缀的随机 key
    const randomBytes = new Uint8Array(20)
    crypto.getRandomValues(randomBytes)
    const keyBody = [...randomBytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    const apiKey = `crm_${keyBody}`
    const keyPrefix = apiKey.slice(0, 12) // crm_ + 8 chars

    const keyHash = await sha256Hex(apiKey)
    const id = uuidv4()

    await c.env.DB.prepare(
      'INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, scopes) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(id, userId, keyHash, keyPrefix, name, JSON.stringify(scopes)).run()

    return c.json({ data: { id, name, keyPrefix, scopes, key: apiKey } }, 201)
  },
)

// DELETE /api/auth/api-keys/:id - 吊销 API Key
apiKeysRoutes.delete('/:id', async (c) => {
  const { userId } = c.get('jwtPayload')
  const id = c.req.param('id')

  const existing = await c.env.DB.prepare(
    'SELECT id FROM api_keys WHERE id = ? AND user_id = ?',
  ).bind(id, userId).first()
  if (!existing) throw new HTTPException(404, { message: 'API Key 不存在' })

  await c.env.DB.prepare('DELETE FROM api_keys WHERE id = ?').bind(id).run()
  return c.json({ data: { success: true } })
})
