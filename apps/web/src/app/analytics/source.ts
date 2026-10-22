// 来源明细：在渠道（搜索、广告……）之外说明具体是哪个搜索引擎、哪个广告平台、哪个网站
// 广告按点击 ID 判断平台，没有点击 ID 时用 utm_source；搜索按来源网址的域名判断搜索引擎
import type { TFunction } from 'i18next'

/** 广告点击 ID → 广告平台（与后端 tracking/channel.ts 的 CLICK_ID_PARAMS 对应） */
const AD_PLATFORMS: Record<string, string> = {
  gclid: 'googleAds', wbraid: 'googleAds', gbraid: 'googleAds',
  msclkid: 'microsoftAds', fbclid: 'meta', ttclid: 'tiktokAds',
  bd_vid: 'baiduAds', bdclkid: 'baiduAds', gdt_vid: 'tencentAds', qz_gdt: 'tencentAds',
}

/** 搜索引擎域名 → 名称（与后端 SEARCH_HOSTS 对应） */
const ENGINES: [RegExp, string][] = [
  [/(^|\.)google\./, 'google'], [/(^|\.)bing\./, 'bing'], [/(^|\.)baidu\./, 'baidu'], [/(^|\.)sogou\./, 'sogou'],
  [/(^|\.)so\.com$/, 'so360'], [/(^|\.)sm\.cn$/, 'shenma'], [/(^|\.)duckduckgo\./, 'duckduckgo'],
  [/(^|\.)yahoo\./, 'yahoo'], [/(^|\.)yandex\./, 'yandex'], [/(^|\.)toutiao\./, 'toutiao'],
]

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, '') } catch { return null }
}

export interface SourceFields {
  channel: string | null
  referrer: string | null
  clickIdType: string | null
  utmSource: string | null
  utmCampaign: string | null
}

/** 具体来源，如「Google」「Google Ads · 品牌词」「chatgpt.com」；直接访问或没有信息时为空 */
export function sourceDetail(t: TFunction, s: SourceFields): string {
  const host = hostOf(s.referrer)
  const engine = host ? ENGINES.find(([re]) => re.test(host))?.[1] : undefined
  const engineName = engine ? t(`analytics.platforms.${engine}`) : null
  let platform: string | null
  if (s.channel === 'paid') {
    const ad = s.clickIdType ? AD_PLATFORMS[s.clickIdType] : undefined
    platform = ad ? t(`analytics.platforms.${ad}`) : s.utmSource || engineName || host || s.clickIdType
  } else if (s.channel === 'search') {
    platform = engineName ?? host ?? s.utmSource
  } else {
    platform = s.utmSource || host
  }
  return [platform, s.utmCampaign].filter(Boolean).join(' · ')
}
