// 来源渠道识别：广告点击 ID / UTM / 来源网址 → paid / search / social / referral / direct

export type Channel = 'paid' | 'search' | 'social' | 'referral' | 'direct'

/** 广告平台点击 ID 参数（出现即视为广告流量） */
export const CLICK_ID_PARAMS = ['bd_vid', 'bdclkid', 'clickid', 'gdt_vid', 'qz_gdt', 'gclid', 'wbraid', 'gbraid', 'fbclid', 'msclkid', 'ttclid'] as const

export const UTM_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const

const SEARCH_HOSTS = /(^|\.)(baidu|google|bing|sogou|so|sm|yandex|duckduckgo|yahoo|toutiao|360)\.(com|cn|[a-z]{2,3})(\.[a-z]{2})?$/i
const SOCIAL_HOSTS = /(^|\.)(weixin\.qq|wx\.qq|qq|weibo|douyin|xiaohongshu|xhslink|zhihu|bilibili|kuaishou|facebook|instagram|twitter|x|t|linkedin|youtube|tiktok|reddit|pinterest|line|whatsapp)\.(com|cn|co|me|net)$/i
const PAID_MEDIUM = /^(cpc|ppc|paid|paidsearch|paid_social|cpm|display|ad|ads|sem|feed)$/i

export interface SourceInput {
  referrer?: string | undefined
  pageHost?: string | undefined
  params?: Record<string, string> | undefined
  userAgent?: string | undefined
}

export interface SourceResult {
  channel: Channel
  referrerHost: string | null
  clickIdType: string | null
  clickId: string | null
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null
  try { return new URL(url).hostname.toLowerCase() } catch { return null }
}

/** 站内跳转（来源是本站）：不算新的来源 */
export function isInternalReferrer(referrer: string | undefined, pageHost: string | undefined): boolean {
  const ref = hostOf(referrer)
  return !!ref && !!pageHost && ref.replace(/^www\./, '') === pageHost.toLowerCase().replace(/^www\./, '')
}

export function classifySource(input: SourceInput): SourceResult {
  const params = input.params ?? {}
  const clickIdType = CLICK_ID_PARAMS.find((p) => params[p]) ?? null
  const clickId = clickIdType ? String(params[clickIdType]).slice(0, 200) : null
  const refHost = isInternalReferrer(input.referrer, input.pageHost) ? null : hostOf(input.referrer)
  const base = { referrerHost: refHost, clickIdType, clickId }

  if (clickIdType || PAID_MEDIUM.test(params.utm_medium ?? '')) return { channel: 'paid', ...base }
  if (refHost && SEARCH_HOSTS.test(refHost)) return { channel: 'search', ...base }
  if (refHost && SOCIAL_HOSTS.test(refHost)) return { channel: 'social', ...base }
  if (params.utm_source) return { channel: /wechat|weixin|weibo|douyin|xhs|zhihu|social/i.test(params.utm_source) ? 'social' : 'referral', ...base }
  if (refHost) return { channel: 'referral', ...base }
  // 微信、抖音等 App 内打开通常没有来源网址
  if (/MicroMessenger|aweme|xhsdiscover|Weibo/i.test(input.userAgent ?? '')) return { channel: 'social', ...base }
  return { channel: 'direct', ...base }
}
