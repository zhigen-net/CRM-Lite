// 网站接入代码模板：网站的 Pages Function / Worker 把同域 /_t/* 转发给 CRM 的 /api/t/*
// 浏览器只看到网站自己的域名；CRM 地址只在服务绑定或网站的加密环境变量里。
// 约定的环境变量 / 绑定：CRM_SITE_KEY（站点密钥，Secret）、CRM（服务绑定，同一 Cloudflare 账号时）或 CRM_URL（不同账号时，Secret）

const FORWARD_BODY = `  const url = new URL(request.url)
  // 采集脚本在网站这边缓存 1 小时，少转发一次（不支持缓存的环境自动跳过）
  const cache = request.method === 'GET' && url.pathname === '/_t/t.js' && typeof caches !== 'undefined' ? caches.default : null
  const cached = cache && await cache.match(request)
  if (cached) return cached
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
  const out = new Response(res.body, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') || 'text/plain', 'Cache-Control': res.headers.get('Cache-Control') || 'no-store' } })
  if (cache && res.ok) await cache.put(request, out.clone())
  return out`

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

export const WORKER_ENTRY_LINE = "if (new URL(request.url).pathname.startsWith('/_t/')) return forwardToCrm(request, env)"

/** 带静态资源的 Worker 网站：让 /_t/* 先进入 Worker，否则会返回静态页面 */
export const ASSETS_CONFIG = `[assets]
# ……原有配置保持不变
run_worker_first = ["/_t/*"]`

/** 服务绑定也可以写在网站的 wrangler 配置里；<crm-worker-name> 由界面替换为 CRM 的 Worker 名 */
export const SERVICE_BINDING_CONFIG = `[[services]]
binding = "CRM"
service = "<crm-worker-name>"`

export const SCRIPT_TAG = '<script src="/_t/t.js" defer></script>'

/** 表单留资：原生表单直接提交到同域 /_t/lead（采集脚本会自动加访客 ID 与防机器人字段） */
export const FORM_HTML = `<form action="/_t/lead" method="post">
  <input name="name" placeholder="姓名" required>
  <input name="phone" placeholder="手机号" required>
  <textarea name="message" placeholder="留言"></textarea>
  <!-- 可选：提交成功后跳回站内页面 -->
  <input type="hidden" name="_redirect" value="/thanks">
  <button type="submit">提交</button>
</form>`

/** 表单留资：自定义前端用采集脚本提供的 submitLead */
export const FORM_JS = `const res = await window.__crmTracker.submitLead({
  name: '张三',
  phone: '13800138000',
  message: '想了解价格',
})
if (res.ok) {
  // 提交成功
} else {
  alert(res.message || '提交失败，请稍后再试')
}`

export function integrationTemplates() {
  return {
    pagesFunction: PAGES_FUNCTION, workerSnippet: WORKER_SNIPPET, workerEntryLine: WORKER_ENTRY_LINE,
    assetsConfig: ASSETS_CONFIG, serviceBindingConfig: SERVICE_BINDING_CONFIG, scriptTag: SCRIPT_TAG,
    formHtml: FORM_HTML, formJs: FORM_JS,
  }
}
