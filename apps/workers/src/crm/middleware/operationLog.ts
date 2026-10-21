// 操作记录中间件：线索、客户、跟进记录之外的写操作（用户、设置、选项、工作流、接入、回收站、附件、登录等）按请求记录
// 线索、客户、跟进记录由业务服务记录（带字段改前改后），这里跳过，避免重复
import type { MiddlewareHandler } from 'hono'
import { recordOperation } from '../../domain/operationLog'
import type { CrmJwtPayload } from '../../shared/jwt'

const SKIP_PREFIXES = [
  '/api/leads', '/api/clients', '/api/activities', '/api/v1', '/api/t/', '/api/mcp', '/api/client/',
  '/api/ai-agent/', '/api/admin/audit-log', '/api/admin/tracking-sites/detect', '/api/auth/register',
]
// 只读接口里需要留痕的：下载文件
const LOGGED_GETS = ['/api/upload/file']
const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-z_-]*\d[0-9a-z_-]*)$/i

/** 把路径里的 ID 换成 :id，便于按操作分类；返回第一个 ID 作为操作对象 */
export function normalizePath(path: string): { route: string; id: string | null } {
  let id: string | null = null
  const route = path.split('/').map((seg, i) => {
    if (i < 3 || !ID_SEGMENT.test(seg) || seg.length < 6) return seg
    id ??= decodeURIComponent(seg)
    return ':id'
  }).join('/')
  return { route, id }
}

export const operationLogMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: { jwtPayload: CrmJwtPayload } }> = async (c, next) => {
  const method = c.req.method
  const path = c.req.path
  const logged = method === 'GET' ? LOGGED_GETS.includes(path) : method !== 'OPTIONS' && method !== 'HEAD'
  if (!logged || !path.startsWith('/api/') || SKIP_PREFIXES.some((p) => path.startsWith(p))) return next()

  // 先取参数（Hono 会缓存请求体，路由里还能再读）
  let input: unknown = null
  if (method === 'GET') input = c.req.query()
  else if ((c.req.header('content-type') ?? '').includes('application/json')) input = await c.req.json().catch(() => null)

  let failure: string | null = null
  try {
    await next()
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    const status = failure ? 500 : c.res.status
    const jwt = c.get('jwtPayload') as CrmJwtPayload | undefined
    const isLogin = path === '/api/auth/login'
    let userId = jwt?.userId ?? null
    if (isLogin && input && typeof input === 'object' && 'email' in input) {
      const row = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(String((input as { email: unknown }).email)).first<{ id: string }>()
      userId = row?.id ?? null
    }
    // 未登录的请求（401）不记，登录失败要记
    if (userId || isLogin) {
      let message: string | null = failure
      if (!message && status >= 400) message = await c.res.clone().json<{ message?: string }>().then((b) => b.message ?? null).catch(() => null)
      const { route, id } = normalizePath(path)
      const ip = c.req.header('CF-Connecting-IP') ?? null
      const write = recordOperation(c.env.DB, userId ? { userId, via: 'web' } : null, {
        action: `${method} ${route}`, targetId: id,
        summary: isLogin ? `登录账号：${String((input as { email?: unknown } | null)?.email ?? '')}` : method === 'GET' ? `文件：${String((input as { key?: unknown } | null)?.key ?? '')}` : null,
        input: isLogin ? null : input, status: status < 400 ? 'ok' : 'error', error: status < 400 ? null : (message ?? `HTTP ${status}`), ip,
      })
      try { c.executionCtx.waitUntil(write) } catch { await write }
    }
  }
}
