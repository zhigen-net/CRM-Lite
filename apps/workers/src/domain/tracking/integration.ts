// 网站接入代码模板：网站的 Pages Function / Worker 把同域 /_t/* 转发给 CRM 的 /api/t/*
// 浏览器只看到网站自己的域名；CRM 地址只在服务绑定或网站的加密环境变量里。
// 约定的环境变量 / 绑定：CRM_SITE_KEY（站点密钥，Secret）、CRM（服务绑定，同一 Cloudflare 账号时）或 CRM_URL（不同账号时，Secret）

const FORWARD_BODY = `  const url = new URL(request.url)
  const cf = request.cf || {}
  const headers = new Headers({
    'Content-Type': request.headers.get('Content-Type') || 'application/json',
    'User-Agent': request.headers.get('User-Agent') || '',
    'X-Site-Key': env.CRM_SITE_KEY,
    // 访客地理信息（城市名可能含非 ASCII 字符，需编码）
    'X-Visitor-Geo': encodeURIComponent(JSON.stringify({
      ip: request.headers.get('CF-Connecting-IP'), country: cf.country, region: cf.region, city: cf.city, isp: cf.asOrganization,
    })),
  })
  const path = url.pathname.replace(/^\\/_t\\//, '/api/t/') + url.search
  const init = { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer() }
  // 同一账号：服务绑定 CRM（不经公网）；不同账号：CRM_URL
  const res = env.CRM ? await env.CRM.fetch(new Request('https://crm' + path, init)) : await fetch(env.CRM_URL + path, init)
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') || 'text/plain', 'Cache-Control': res.headers.get('Cache-Control') || 'no-store' } })`

/** Pages 网站：保存为 functions/_t/[[path]].js */
export const PAGES_FUNCTION = `// 访客统计转发（CRM）：浏览器只访问本站 /_t/*，这里在服务器端转发给 CRM
export async function onRequest({ request, env }) {
${FORWARD_BODY}
}
`

/** Worker 网站：放进现有 fetch 入口，/_t/ 开头的请求交给 forwardToCrm */
export const WORKER_SNIPPET = `// 访客统计转发（CRM）：在 fetch 入口最前面加上
//   if (new URL(request.url).pathname.startsWith('/_t/')) return forwardToCrm(request, env)
async function forwardToCrm(request, env) {
${FORWARD_BODY}
}
`

export const SCRIPT_TAG = '<script src="/_t/t.js" defer></script>'

export function integrationTemplates() {
  return { pagesFunction: PAGES_FUNCTION, workerSnippet: WORKER_SNIPPET, scriptTag: SCRIPT_TAG }
}
