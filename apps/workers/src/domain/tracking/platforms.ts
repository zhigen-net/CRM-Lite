// 网站接入的部署平台与转发模板（同域转发模式）：浏览器只访问网站自己的 /_t/*，由网站服务器端带站点密钥转发到 CRM 的 /api/t/*
// 所有模板都遵守同一份转发协议（PROXY_SPEC）；没有模板的平台由 AI 按协议实现
// 模板里的 {{CRM_URL}} / {{CRM_HOST}} 由界面替换为当前 CRM 地址（只用于写进服务器端配置，不进前端代码）
import { PAGES_FUNCTION, WORKER_SNIPPET } from './integration'

export const PLATFORMS = [
  'cloudflare_pages', 'cloudflare_workers', 'vercel', 'netlify', 'edgeone_pages', 'nginx', 'php', 'node', 'other', 'static',
] as const
export type Platform = typeof PLATFORMS[number]

export interface TemplateFile { path: string; code: string }

/** 转发协议：任何技术栈照此实现即可 */
export const PROXY_SPEC = `把网站的 /_t/* 在服务器端转发到 CRM：{CRM_URL}/api/t/*（保留后面的路径和查询参数，GET / POST 都要转发，请求体原样转发）
转发时设置这些请求头（不要转发浏览器的 Cookie、Authorization）：
  X-Site-Key: 站点密钥（从服务器端环境变量或配置读取，绝不能出现在前端代码里）
  X-Visitor-Geo: encodeURIComponent(JSON.stringify({ ip, country, region, city, isp }))   // 至少带 ip（访客真实 IP，经 CDN 时取 X-Forwarded-For 第一个）；平台能提供地区就一起带上
  User-Agent、Content-Type：原样转发
把 CRM 的响应原样返回给浏览器：状态码、响应体，以及 Content-Type、Cache-Control 两个响应头（不要转发 Set-Cookie）
自检：GET /_t/t.js 返回 200 且是 JavaScript；POST /_t/collect 和 POST /_t/lead 发送 {"ping":1}（Content-Type: application/json）都返回 {"data":{"siteId":"..."}}`

const VERCEL_MIDDLEWARE = `// 访客统计转发（CRM）：浏览器只访问本站 /_t/*，这里在服务器端转发给 CRM
// 放在项目根目录的 middleware.js（Next.js 使用 src/ 目录时放在 src/middleware.js）
// 已有 middleware 时：把 config.matcher 合并进去，并在原函数最前面加
//   if (new URL(request.url).pathname.startsWith('/_t/')) return forwardToCrm(request)
export const config = { matcher: '/_t/:path*' }

export default function middleware(request) {
  return forwardToCrm(request)
}

async function forwardToCrm(request) {
  const url = new URL(request.url)
  const h = request.headers
  const dec = (v) => { try { return v ? decodeURIComponent(v) : undefined } catch { return v } }
  const headers = new Headers({
    'Content-Type': h.get('content-type') || 'application/json',
    'User-Agent': h.get('user-agent') || '',
    'X-Site-Key': process.env.CRM_SITE_KEY,
    // 访客地理信息：Vercel 提供国家、省份、城市（城市名已 URL 编码）
    'X-Visitor-Geo': encodeURIComponent(JSON.stringify({
      ip: h.get('x-real-ip') || (h.get('x-forwarded-for') || '').split(',')[0].trim(),
      country: h.get('x-vercel-ip-country'), region: h.get('x-vercel-ip-country-region'), city: dec(h.get('x-vercel-ip-city')),
    })),
  })
  const path = url.pathname.replace(/^\\/_t\\//, '/api/t/') + url.search
  const res = await fetch(process.env.CRM_URL + path, {
    method: request.method, headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
  })
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') || 'text/plain', 'Cache-Control': res.headers.get('Cache-Control') || 'no-store' } })
}
`

const NETLIFY_EDGE = `// 访客统计转发（CRM）：浏览器只访问本站 /_t/*，这里在服务器端转发给 CRM
// 保存为 netlify/edge-functions/crm-proxy.js
export default async (request, context) => {
  const url = new URL(request.url)
  const geo = context.geo || {}
  const headers = new Headers({
    'Content-Type': request.headers.get('content-type') || 'application/json',
    'User-Agent': request.headers.get('user-agent') || '',
    'X-Site-Key': Netlify.env.get('CRM_SITE_KEY'),
    'X-Visitor-Geo': encodeURIComponent(JSON.stringify({
      ip: context.ip, country: geo.country && geo.country.code, region: geo.subdivision && geo.subdivision.name, city: geo.city,
    })),
  })
  const path = url.pathname.replace(/^\\/_t\\//, '/api/t/') + url.search
  const res = await fetch(Netlify.env.get('CRM_URL') + path, {
    method: request.method, headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
  })
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') || 'text/plain', 'Cache-Control': res.headers.get('Cache-Control') || 'no-store' } })
}

export const config = { path: '/_t/*' }
`

const EDGEONE_FUNCTION = `// 访客统计转发（CRM）：浏览器只访问本站 /_t/*，这里在服务器端转发给 CRM
// 腾讯云 EdgeOne Pages：保存为 functions/_t/[[default]].js（通配路由的文件名以 EdgeOne Pages 官方文档为准）
export async function onRequest({ request, env }) {
  const url = new URL(request.url)
  const eo = request.eo || {}
  const geo = eo.geo || {}
  const headers = new Headers({
    'Content-Type': request.headers.get('content-type') || 'application/json',
    'User-Agent': request.headers.get('user-agent') || '',
    'X-Site-Key': env.CRM_SITE_KEY,
    'X-Visitor-Geo': encodeURIComponent(JSON.stringify({
      ip: eo.clientIp || request.headers.get('eo-client-ip') || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim(),
      country: geo.countryCodeAlpha2, region: geo.regionName, city: geo.cityName, isp: geo.cisp,
    })),
  })
  const path = url.pathname.replace(/^\\/_t\\//, '/api/t/') + url.search
  const res = await fetch(env.CRM_URL + path, {
    method: request.method, headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
  })
  return new Response(res.body, { status: res.status, headers: { 'Content-Type': res.headers.get('Content-Type') || 'text/plain', 'Cache-Control': res.headers.get('Cache-Control') || 'no-store' } })
}
`

const NGINX_CONF = `# 访客统计转发（CRM）：放进网站的 server { } 配置里（宝塔：网站 → 设置 → 配置文件）
# 浏览器只访问本站 /_t/*，由 Nginx 带站点密钥转发给 CRM
location /_t/ {
    include /etc/nginx/crm_site_key.conf;   # 站点密钥单独放在这个文件，不要提交到代码仓库
    proxy_pass {{CRM_URL}}/api/t/;
    proxy_ssl_server_name on;
    proxy_set_header Host {{CRM_HOST}};
    proxy_set_header X-Site-Key $crm_site_key;
    # 访客真实 IP；网站前面有 CDN 时，改用 CDN 传来的真实 IP（如 $http_x_forwarded_for 的第一个，或开启 realip 模块）
    proxy_set_header X-Visitor-Geo '{"ip":"$remote_addr"}';
    proxy_set_header Cookie "";
    proxy_set_header Authorization "";
    proxy_hide_header Set-Cookie;
}`

const NGINX_KEY_FILE = `# /etc/nginx/crm_site_key.conf（权限设为 600，不要放进网站目录或代码仓库）
set $crm_site_key "这里填站点密钥 cts_...";`

const PHP_PROXY = `<?php
// 访客统计转发（CRM）：浏览器只访问本站 /_t/*，这里在服务器端转发给 CRM
// 保存为网站根目录下的 _t/index.php；配置读取环境变量 CRM_URL、CRM_SITE_KEY，或同目录的 config.php
$config = is_file(__DIR__ . '/config.php') ? (include __DIR__ . '/config.php') : [];
$crmUrl = rtrim(getenv('CRM_URL') ?: ($config['CRM_URL'] ?? ''), '/');
$siteKey = getenv('CRM_SITE_KEY') ?: ($config['CRM_SITE_KEY'] ?? '');

$path = preg_replace('#^.*?/_t/#', '', parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
$query = $_SERVER['QUERY_STRING'] ?? '';
$target = $crmUrl . '/api/t/' . $path . ($query !== '' ? '?' . $query : '');

// 访客真实 IP：经 Cloudflare 或其它 CDN 时取对应的请求头
$ip = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? trim(explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '')[0]);
if ($ip === '') $ip = $_SERVER['REMOTE_ADDR'] ?? '';

// multipart 表单在 PHP 里拿不到原始请求体，改为按普通表单转发（文件字段忽略）
$contentType = $_SERVER['CONTENT_TYPE'] ?? 'application/json';
$requestBody = file_get_contents('php://input');
if (stripos($contentType, 'multipart/form-data') !== false) {
    $requestBody = http_build_query($_POST);
    $contentType = 'application/x-www-form-urlencoded';
}

$responseHeaders = [];
$ch = curl_init($target);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 8,
    CURLOPT_HTTPHEADER => [
        'X-Site-Key: ' . $siteKey,
        'X-Visitor-Geo: ' . rawurlencode(json_encode(['ip' => $ip])),
        'User-Agent: ' . ($_SERVER['HTTP_USER_AGENT'] ?? ''),
        'Content-Type: ' . $contentType,
    ],
    CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$responseHeaders) {
        $parts = explode(':', $line, 2);
        if (count($parts) === 2) $responseHeaders[strtolower(trim($parts[0]))] = trim($parts[1]);
        return strlen($line);
    },
]);
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $requestBody);
}
$body = curl_exec($ch);
$status = $body === false ? 502 : curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);

http_response_code($status ?: 502);
header('Content-Type: ' . ($responseHeaders['content-type'] ?? 'text/plain'));
header('Cache-Control: ' . ($responseHeaders['cache-control'] ?? 'no-store'));
echo $body === false ? '' : $body;
`

const PHP_HTACCESS = `# Apache：把 /_t/ 下的请求都交给 index.php（保存为 _t/.htaccess）
# 使用 Nginx + PHP-FPM 时，改为在 server { } 里加：location /_t/ { try_files $uri /_t/index.php?$query_string; }
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteRule ^ index.php [L,QSA]
<Files "config.php">
  Require all denied
</Files>`

const PHP_CONFIG = `<?php
// _t/config.php：服务器上的配置文件，不要提交到代码仓库（也可以改用环境变量 CRM_URL、CRM_SITE_KEY）
return [
    'CRM_URL' => '{{CRM_URL}}',
    'CRM_SITE_KEY' => '这里填站点密钥 cts_...',
];`

const NODE_PROXY = `// 访客统计转发（CRM）：浏览器只访问本站 /_t/*，这里在服务器端转发给 CRM（Node.js 18+，自带 fetch）
// Express：在解析请求体的中间件（express.json() 等）之前挂载：app.use('/_t', crmProxy)
// 原生 http：if (req.url.startsWith('/_t/')) { req.url = req.url.slice(3); return crmProxy(req, res) }
// CommonJS 项目把 export default 改为 module.exports =
export default async function crmProxy(req, res) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const ip = (req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim()
  const crmRes = await fetch(process.env.CRM_URL + '/api/t' + req.url, {
    method: req.method,
    headers: {
      'Content-Type': req.headers['content-type'] || 'application/json',
      'User-Agent': req.headers['user-agent'] || '',
      'X-Site-Key': process.env.CRM_SITE_KEY,
      'X-Visitor-Geo': encodeURIComponent(JSON.stringify({ ip })),
    },
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
  })
  res.statusCode = crmRes.status
  res.setHeader('Content-Type', crmRes.headers.get('Content-Type') || 'text/plain')
  res.setHeader('Cache-Control', crmRes.headers.get('Cache-Control') || 'no-store')
  res.end(Buffer.from(await crmRes.arrayBuffer()))
}
`

/** 各平台需要新增 / 修改的文件；static 与 other 没有模板（other 按转发协议实现，static 需要后续的子域名模式） */
export function platformTemplates(): Record<Platform, TemplateFile[]> {
  return {
    cloudflare_pages: [{ path: 'functions/_t/[[path]].js', code: PAGES_FUNCTION }],
    cloudflare_workers: [{ path: 'Worker 入口文件（加 forwardToCrm）', code: WORKER_SNIPPET }],
    vercel: [{ path: 'middleware.js', code: VERCEL_MIDDLEWARE }],
    netlify: [{ path: 'netlify/edge-functions/crm-proxy.js', code: NETLIFY_EDGE }],
    edgeone_pages: [{ path: 'functions/_t/[[default]].js', code: EDGEONE_FUNCTION }],
    nginx: [{ path: 'Nginx server 配置', code: NGINX_CONF }, { path: '/etc/nginx/crm_site_key.conf', code: NGINX_KEY_FILE }],
    php: [{ path: '_t/index.php', code: PHP_PROXY }, { path: '_t/.htaccess', code: PHP_HTACCESS }, { path: '_t/config.php', code: PHP_CONFIG }],
    node: [{ path: 'crm-proxy.js', code: NODE_PROXY }],
    other: [],
    static: [],
  }
}

// ─── 识别部署平台 ────────────────────────────────────────────────────────────

export interface DetectResult { platform: Platform | null; evidence: string[]; behindCloudflare: boolean }

/** 根据网站首页的响应头判断部署平台（只作推荐，最终由用户确认） */
export function detectFromHeaders(headers: Headers): DetectResult {
  const get = (k: string) => (headers.get(k) ?? '').toLowerCase()
  const has = (k: string) => headers.has(k)
  const server = get('server')
  const powered = get('x-powered-by')
  const evidence: string[] = []
  const hit = (platform: Platform, why: string): DetectResult => {
    evidence.push(why)
    return { platform, evidence, behindCloudflare: has('cf-ray') }
  }
  if (has('x-vercel-id') || server.includes('vercel')) return hit('vercel', 'x-vercel-id / server: Vercel')
  if (has('x-nf-request-id') || server.includes('netlify')) return hit('netlify', 'x-nf-request-id / server: Netlify')
  if ([...headers.keys()].some((k) => k.startsWith('eo-')) || server.includes('edgeone')) return hit('edgeone_pages', 'eo-* 响应头（腾讯云 EdgeOne）')
  if (has('x-github-request-id') || server.includes('github')) return hit('static', 'GitHub Pages（纯静态托管）')
  if (has('x-oss-request-id')) return hit('static', '阿里云 OSS 静态网站（纯静态托管）')
  if (has('x-cos-request-id')) return hit('static', '腾讯云 COS 静态网站（纯静态托管）')
  if (powered.includes('php')) return hit('php', `x-powered-by: ${headers.get('x-powered-by')}`)
  if (powered.includes('express')) return hit('node', 'x-powered-by: Express')
  if (has('cf-ray')) {
    // 经 Cloudflare 的网站可能是 Pages / Workers，也可能只是用 Cloudflare 加速的其它服务器
    if (server.includes('nginx') || server.includes('apache') || server.includes('tengine')) return hit('nginx', `经 Cloudflare 加速的 ${headers.get('server')} 服务器`)
    return hit('cloudflare_pages', 'cf-ray（Cloudflare）；如果网站是 Worker 请改选 Cloudflare Workers')
  }
  if (server.includes('nginx') || server.includes('tengine') || server.includes('openresty')) return hit('nginx', `server: ${headers.get('server')}`)
  if (server.includes('apache') || server.includes('litespeed')) return hit('php', `server: ${headers.get('server')}（通常可运行 PHP）`)
  return { platform: null, evidence, behindCloudflare: false }
}
