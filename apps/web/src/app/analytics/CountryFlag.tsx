// IP 所属国家的国旗（Cloudflare 提供的 ISO 国家代码，如 CN、US）
// 国旗是 flag-icons 的 SVG，只在显示时按需下载；Windows 不显示国旗 emoji，所以不用 emoji
import { useTranslation } from 'react-i18next'

const FLAGS = import.meta.glob<string>('/node_modules/flag-icons/flags/4x3/*.svg', { eager: true, query: '?url', import: 'default' })
const flagUrl = (code: string) => FLAGS[`/node_modules/flag-icons/flags/4x3/${code.toLowerCase()}.svg`]

/** 国家名称跟随界面语言（浏览器自带的 Intl.DisplayNames） */
export function countryName(code: string, lang: string): string {
  try { return new Intl.DisplayNames([lang === 'zh' ? 'zh-CN' : 'en'], { type: 'region' }).of(code.toUpperCase()) ?? code } catch { return code }
}

export function CountryFlag({ code }: { code?: string | null | undefined }) {
  const { i18n } = useTranslation()
  if (!code || !/^[a-z]{2}$/i.test(code)) return null
  const url = flagUrl(code)
  const name = countryName(code, i18n.language)
  if (!url) return <span className="text-xs text-gray-400" title={name}>{code.toUpperCase()}</span>
  return <img src={url} alt={name} title={name} loading="lazy" className="inline-block h-3 w-4 flex-none rounded-[2px] object-cover align-[-1px] ring-1 ring-black/5" />
}
