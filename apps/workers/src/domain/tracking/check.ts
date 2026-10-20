// 接入检测：CRM 从服务器端访问网站的 /_t/t.js 与 /_t/collect，判断转发代码、站点密钥是否配置正确
// 只允许检测公网域名（不接受 IP、localhost），避免被用来探测内网
import { badRequest } from '../errors'
import type { TrackingSite } from './sites'

export type CheckReason =
  | 'ok' | 'unreachable' | 'not_found' | 'html' | 'redirect' | 'bad_key' | 'wrong_site' | 'server_error' | 'unexpected'

export interface CheckStep { ok: boolean; status: number | null; reason: CheckReason }
export interface CheckResult { host: string; script: CheckStep; collect: CheckStep; lead: CheckStep }

const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** 把用户输入的网址或域名整理成主机名；不合法时抛错 */
export function normalizeHost(input: string): string {
  const raw = input.trim().toLowerCase().replace(/^https?:\/\//, '').split(/[/?#]/)[0] ?? ''
  const host = raw.replace(/:443$/, '')
  if (!HOST_RE.test(host)) throw badRequest('请填写网站域名，如 www.example.com')
  return host
}

const TIMEOUT_MS = 8000

async function tryFetch(fetcher: typeof fetch, url: string, init: RequestInit): Promise<Response | null> {
  try {
    return await fetcher(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    return null
  }
}

function statusReason(status: number): CheckReason {
  if (status >= 300 && status < 400) return 'redirect'
  // 静态托管对未部署的路径返回 404，对 POST 常返回 405
  if (status === 404 || status === 405) return 'not_found'
  if (status >= 500) return 'server_error'
  return 'unexpected'
}

export async function checkSiteIntegration(site: TrackingSite, host: string, fetcher: typeof fetch = fetch): Promise<CheckResult> {
  const base = `https://${host}/_t`
  const headers = { 'User-Agent': 'CRM-Integration-Check/1.0' }

  // 1. 采集脚本：应返回 JavaScript，而不是网站的 HTML 页面
  let script: CheckStep
  const sRes = await tryFetch(fetcher, `${base}/t.js`, { headers })
  if (!sRes) script = { ok: false, status: null, reason: 'unreachable' }
  else if (sRes.status !== 200) script = { ok: false, status: sRes.status, reason: statusReason(sRes.status) }
  else {
    const body = await sRes.text()
    script = body.includes('__crmTracker')
      ? { ok: true, status: 200, reason: 'ok' }
      : { ok: false, status: 200, reason: /<html|<!doctype/i.test(body) ? 'html' : 'unexpected' }
  }

  // 2. 上报、3. 表单留资：发送探测请求（不写入数据），确认转发带上了这个站点的密钥
  const probe = async (path: string): Promise<CheckStep> => {
    const res = await tryFetch(fetcher, `${base}/${path}`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ ping: 1 }),
    })
    if (!res) return { ok: false, status: null, reason: 'unreachable' }
    if (res.status === 401) return { ok: false, status: 401, reason: 'bad_key' }
    if (res.status !== 200) return { ok: false, status: res.status, reason: statusReason(res.status) }
    const data = await res.json<{ data?: { siteId?: string } }>().catch(() => null)
    const siteId = data?.data?.siteId
    return siteId === site.id ? { ok: true, status: 200, reason: 'ok' } : { ok: false, status: 200, reason: siteId ? 'wrong_site' : 'html' }
  }
  const collect = await probe('collect')
  const lead = await probe('lead')

  return { host, script, collect, lead }
}
