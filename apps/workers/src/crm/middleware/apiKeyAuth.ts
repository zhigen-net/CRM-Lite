import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { SCOPES, type Scope } from '../../domain/capabilities'

declare module 'hono' {
  interface ContextVariableMap {
    /** 通过 API Key 鉴权时的密钥信息 */
    apiKey: { id: string; scopes: Scope[] }
  }
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** 解析数据库中的 scopes（JSON 数组），忽略无法识别的值 */
export function parseScopes(raw: string | null | undefined): Scope[] {
  try {
    const arr = JSON.parse(raw ?? '[]') as unknown
    return Array.isArray(arr) ? arr.filter((s): s is Scope => (SCOPES as readonly string[]).includes(s as string)) : []
  } catch {
    return []
  }
}

export const requireApiKey = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const apiKey = c.req.header('X-API-Key')
  if (!apiKey?.startsWith('crm_')) {
    throw new HTTPException(401, { message: '缺少有效的 X-API-Key 请求头' })
  }

  const hash = await sha256Hex(apiKey)

  const row = await c.env.DB.prepare(
    `SELECT ak.id, ak.user_id, ak.scopes, u.role, u.team_id
     FROM api_keys ak JOIN users u ON ak.user_id = u.id
     WHERE ak.key_hash = ?`,
  ).bind(hash).first<{ id: string; user_id: string; scopes: string | null; role: string; team_id: string | null }>()

  if (!row) throw new HTTPException(401, { message: 'API Key 无效' })

  // 异步更新最后使用时间（不阻塞请求）
  void c.env.DB.prepare('UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(row.id).run()

  c.set('jwtPayload', {
    userId: row.user_id,
    role: row.role as 'admin' | 'operations' | 'sales',
    teamId: row.team_id,
    exp: 0,
  })
  c.set('apiKey', { id: row.id, scopes: parseScopes(row.scopes) })
  await next()
})

/** 要求 API Key 具备指定权限范围（放在 requireApiKey 之后） */
export const requireScope = (scope: Scope) => createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (!c.get('apiKey').scopes.includes(scope)) {
    throw new HTTPException(403, { message: `此 API Key 未授权 ${scope}` })
  }
  await next()
})
