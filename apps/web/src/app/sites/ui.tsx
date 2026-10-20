// 网站接入页面共用的小组件与类型
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/components/Button'

export const PLATFORMS = [
  'cloudflare_pages', 'cloudflare_workers', 'vercel', 'netlify', 'edgeone_pages', 'nginx', 'php', 'node', 'other', 'static',
] as const
export type Platform = typeof PLATFORMS[number]
/** 平台分组：边缘 / Serverless、服务器、其它 */
export const PLATFORM_GROUPS: { key: string; items: Platform[] }[] = [
  { key: 'edge', items: ['cloudflare_pages', 'cloudflare_workers', 'vercel', 'netlify', 'edgeone_pages'] },
  { key: 'server', items: ['nginx', 'php', 'node'] },
  { key: 'other', items: ['other', 'static'] },
]
export const isCloudflare = (p: Platform | null | undefined) => p === 'cloudflare_pages' || p === 'cloudflare_workers'

export interface SiteFeatures { forms: boolean; connect: 'binding' | 'url' }
export interface SiteDetail {
  id: string; name: string; domain: string | null; keyPrefix: string; isActive: boolean
  createdAt: string; lastSeenAt: string | null; visitorCount: number
  visitorsDay?: number; leadsDay?: number; blockedDay?: number; openFailures?: number
  platform: Platform | null; features: SiteFeatures
}
export interface TemplateFile { path: string; code: string }
export interface Integration {
  workerEntryLine: string; assetsConfig: string; serviceBindingConfig: string
  scriptTag: string; formHtml: string; formJs: string
  platforms: Record<Platform, TemplateFile[]>; proxySpec: string
}

export function CopyBlock({ label, code, tall }: { label?: string | undefined; code: string; tall?: boolean }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate font-mono text-xs font-medium text-gray-700">{label}</p>
        <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => {})}>
          {copied ? t('profile.api.copied') : t('profile.api.copy')}
        </Button>
      </div>
      <pre className={`${tall ? 'max-h-96' : 'max-h-56'} overflow-auto whitespace-pre rounded border bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700`}>{code}</pre>
    </div>
  )
}

export function Note({ children, tone = 'gray' }: { children: ReactNode; tone?: 'gray' | 'amber' | 'green' | 'red' }) {
  const cls = { gray: 'bg-gray-50 text-gray-600', amber: 'bg-amber-50 text-amber-800', green: 'bg-green-50 text-green-800', red: 'bg-red-50 text-red-700' }[tone]
  return <div className={`rounded-lg px-3 py-2 text-xs ${cls}`}>{children}</div>
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="rounded-lg border bg-white">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-sm font-medium text-gray-900">{title}</h2>
        {aside}
      </div>
      <div className="space-y-3 p-4 text-sm text-gray-700">{children}</div>
    </section>
  )
}

const STAT_TONE = { gray: 'bg-gray-100 text-gray-600', green: 'bg-green-50 text-green-700', amber: 'bg-amber-50 text-amber-700', red: 'bg-red-50 text-red-700' }
export function Stat({ label, value, tone = 'gray' }: { label: string; value: number; tone?: keyof typeof STAT_TONE }) {
  return <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${STAT_TONE[tone]}`}>{label}<b className="font-semibold">{value}</b></span>
}

/** 超过 24 小时没有收到数据（时间为 UTC 的 YYYY-MM-DD HH:MM:SS） */
export function isStale(lastSeenAt: string | null) {
  if (!lastSeenAt) return true
  const ts = Date.parse(lastSeenAt.includes('T') ? lastSeenAt : `${lastSeenAt.replace(' ', 'T')}Z`)
  return Number.isFinite(ts) && Date.now() - ts > 24 * 3600 * 1000
}

/** CRM 部署在 workers.dev 上时，子域名的第一段就是 Worker 名 */
export function guessWorkerName(): string | null {
  const host = window.location.hostname
  return host.endsWith('.workers.dev') ? host.split('.')[0] ?? null : null
}
