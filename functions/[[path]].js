// Cloudflare Pages Function：把所有请求原样转发到环境变量 TARGET_URL 指定的地址。
// 用途：Worker 无法绑定其他 Cloudflare 账号下的域名时，在该账号里建一个 Pages
// 项目，绑定自定义域名，再由它中转到 Worker（例如 https://xxx.workers.dev）。

export async function onRequest({ request, env }) {
  const target = env.TARGET_URL || env.URL
  if (!target) {
    return new Response('未设置环境变量 TARGET_URL', { status: 500 })
  }

  let base
  try {
    base = new URL(target)
  } catch {
    return new Response('TARGET_URL 不是合法的 URL：' + target, { status: 500 })
  }

  const incoming = new URL(request.url)
  const upstream = new URL(base.origin)
  upstream.pathname = base.pathname.replace(/\/+$/, '') + incoming.pathname
  upstream.search = incoming.search

  const headers = new Headers(request.headers)
  headers.set('X-Forwarded-Host', incoming.host)
  headers.set('X-Forwarded-Proto', incoming.protocol.replace(':', ''))
  const ip = request.headers.get('CF-Connecting-IP')
  if (ip) headers.set('X-Forwarded-For', ip)

  const response = await fetch(upstream.toString(), {
    method: request.method,
    headers,
    body: request.body,
    redirect: 'manual',
  })

  // WebSocket 升级响应直接返回
  if (response.status === 101) return response

  const out = new Response(response.body, response)

  // 把指向上游域名的重定向改写回当前域名
  const location = out.headers.get('Location')
  if (location) {
    try {
      const loc = new URL(location, upstream)
      if (loc.host === base.host) {
        loc.protocol = incoming.protocol
        loc.host = incoming.host
        out.headers.set('Location', loc.toString())
      }
    } catch {}
  }

  // 去掉 Cookie 上的 Domain 属性，让 Cookie 落在当前域名
  const cookies = out.headers.getSetCookie ? out.headers.getSetCookie() : []
  if (cookies.length) {
    out.headers.delete('Set-Cookie')
    for (const c of cookies) {
      out.headers.append('Set-Cookie', c.replace(/;\s*Domain=[^;]*/i, ''))
    }
  }

  return out
}
