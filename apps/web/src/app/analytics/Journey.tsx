// 访问轨迹：访客分析页、线索 / 客户详情的「网站来源」共用
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { crmApi } from '@/shared/utils/request'
import { formatDate } from '@/shared/utils/format'

export interface JourneyVisitor {
  id: string; firstSeenAt: string; visitCount: number; pageviewCount: number
  firstChannel: string | null; firstReferrer: string | null; firstLanding: string | null
  firstUtmSource: string | null; firstUtmMedium: string | null; firstUtmCampaign: string | null; firstClickIdType: string | null
  deviceType: string | null; region: string | null; city: string | null
  leadId: string | null; leadName: string | null
}
export interface TrackEvent { id: string; type: string; path: string | null; title: string | null; durationMs: number | null; scrollPct: number | null; createdAt: string }
export interface Visit {
  id: string; startedAt: string; endedAt: string; pageviews: number; durationSec: number; landingPath: string | null
  referrer: string | null; channel: string | null; utmSource: string | null; utmCampaign: string | null; clickIdType: string | null
  deviceType: string | null; os: string | null; browser: string | null; screen: string | null; network: string | null
  region: string | null; city: string | null; isp: string | null; events: TrackEvent[]
}

export interface Journey { siteId?: string; siteName?: string; visitor: JourneyVisitor; visits: Visit[] }

/** 同一个 url 的轨迹数据在卡片和抽屉之间共用缓存；线索没有关联访客时为 null */
export function useJourney(url: string) {
  return useQuery({
    queryKey: ['visitor-journey', url],
    queryFn: () => crmApi.get<{ data: Journey | null }>(url).then((r) => r.data.data),
  })
}

export function duration(sec: number) {
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  return m < 60 ? `${m}m${sec % 60 ? ` ${sec % 60}s` : ''}` : `${Math.floor(m / 60)}h ${m % 60}m`
}
export const place = (v: { region: string | null; city: string | null }) => [v.region, v.city].filter(Boolean).join(' ') || '—'

/** 访问轨迹抽屉：url 为访客轨迹或线索 / 客户来源接口（两者返回同样的 visitor + visits） */
export function JourneyDrawer({ url, onClose }: { url: string; onClose: () => void }) {
  const { t } = useTranslation()
  const { data, isLoading } = useJourney(url)
  const ch = (c: string | null) => (c ? t(`analytics.channels.${c}`, { defaultValue: c }) : '—')

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-xl overflow-y-auto bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b bg-white px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">{t('analytics.journey.title')}</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-xl text-gray-400 hover:bg-gray-100">×</button>
        </div>
        {isLoading || !data ? (
          <div className="p-5 text-sm text-gray-400">{t('common.loading')}</div>
        ) : (
          <div className="space-y-4 p-5 text-sm">
            <div className="grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-3 text-xs">
              <div><p className="text-gray-400">{t('analytics.journey.firstSource')}</p><p className="mt-0.5 text-gray-800">{ch(data.visitor.firstChannel)}{data.visitor.firstUtmCampaign ? ` · ${data.visitor.firstUtmCampaign}` : ''}</p></div>
              <div><p className="text-gray-400">{t('analytics.journey.firstLanding')}</p><p className="mt-0.5 truncate text-gray-800">{data.visitor.firstLanding ?? '—'}</p></div>
              <div><p className="text-gray-400">{t('analytics.journey.visits')}</p><p className="mt-0.5 text-gray-800">{data.visitor.visitCount} / {data.visitor.pageviewCount}</p></div>
              <div><p className="text-gray-400">{t('analytics.journey.lead')}</p>
                <p className="mt-0.5">{data.visitor.leadId
                  ? <Link className="text-primary-600 hover:underline" to={`/app/leads/${data.visitor.leadId}`}>{data.visitor.leadName ?? t('analytics.journey.viewLead')}</Link>
                  : <span className="text-gray-400">{t('analytics.journey.noLead')}</span>}</p></div>
            </div>
            {data.visits.map((v) => (
              <div key={v.id} className="rounded-lg border">
                <div className="border-b bg-gray-50 px-3 py-2 text-xs">
                  <p className="font-medium text-gray-800">{formatDate(v.startedAt)} · {ch(v.channel)}{v.utmSource ? ` · ${v.utmSource}` : ''}{v.utmCampaign ? ` / ${v.utmCampaign}` : ''}</p>
                  <p className="mt-0.5 text-gray-500">
                    {t('analytics.journey.visitSummary', { pages: v.pageviews, time: duration(v.durationSec) })} · {[v.deviceType && t(`analytics.devices.${v.deviceType}`), v.os, v.browser].filter(Boolean).join(' / ')}
                    {' · '}{place(v)}{v.isp ? ` · ${v.isp}` : ''}{v.network ? ` · ${v.network}` : ''}
                  </p>
                  {v.referrer && <p className="mt-0.5 truncate text-gray-400">{t('analytics.journey.referrer')}：{v.referrer}</p>}
                </div>
                <ul className="divide-y divide-gray-50">
                  {v.events.filter((e) => e.type !== 'leave').map((e) => {
                    const leave = v.events.find((x) => x.type === 'leave' && x.path === e.path && x.createdAt >= e.createdAt)
                    return (
                      <li key={e.id} className="flex items-start gap-2 px-3 py-1.5 text-xs">
                        <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 ${e.type === 'pageview' ? 'bg-gray-100 text-gray-600' : 'bg-amber-100 text-amber-700'}`}>
                          {t(`analytics.events.${e.type}`, { defaultValue: e.type })}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-gray-800">{e.title || e.path}</span>
                          {e.title && <span className="block truncate text-gray-400">{e.path}</span>}
                        </span>
                        {e.type === 'pageview' && leave?.durationMs != null && (
                          <span className="shrink-0 text-gray-400">{duration(Math.round(leave.durationMs / 1000))}{leave.scrollPct != null ? ` · ${leave.scrollPct}%` : ''}</span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** 线索 / 客户详情的「网站来源」：没有关联访客时不显示 */
export function VisitorSourceCard({ url }: { url: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { data } = useJourney(url)
  if (!data) return null
  const v = data.visitor
  const ch = v.firstChannel ? t(`analytics.channels.${v.firstChannel}`, { defaultValue: v.firstChannel }) : '—'
  const ad = [v.firstUtmSource, v.firstUtmMedium, v.firstUtmCampaign].filter(Boolean).join(' / ')
  const items: [string, string][] = [
    [t('analytics.source.channel'), v.firstClickIdType ? `${ch}（${v.firstClickIdType}）` : ch],
    [t('analytics.source.campaign'), ad || '—'],
    [t('analytics.source.landing'), v.firstLanding ?? '—'],
    [t('analytics.source.referrer'), v.firstReferrer ?? '—'],
    [t('analytics.source.firstSeen'), formatDate(v.firstSeenAt)],
    [t('analytics.source.visits'), t('analytics.source.visitsValue', { visits: v.visitCount, pages: v.pageviewCount })],
  ]
  return (
    <div className="mb-4 rounded-lg border bg-white p-4 sm:mb-6 sm:p-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-gray-900">{t('analytics.source.title')}</h2>
          {data.siteName && <p className="mt-0.5 text-xs text-gray-400">{t('analytics.source.site', { name: data.siteName })}</p>}
        </div>
        <button type="button" className="text-sm text-primary-600 hover:text-primary-800" onClick={() => setOpen(true)}>{t('analytics.source.viewJourney')}</button>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {items.map(([k, val]) => (
          <div key={k} className="min-w-0">
            <dt className="text-xs text-gray-400">{k}</dt>
            <dd className="truncate text-gray-800" title={val}>{val}</dd>
          </div>
        ))}
      </dl>
      {open && <JourneyDrawer url={url} onClose={() => setOpen(false)} />}
    </div>
  )
}
