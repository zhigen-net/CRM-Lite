// 访客分析：访客列表、访问轨迹；管理员还可以管理站点
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { crmApi } from '@/shared/utils/request'
import { formatDate } from '@/shared/utils/format'
import { useCrmAuth } from '@/app/auth/CrmAuthContext'
import { Pagination } from '@/shared/components/Pagination'
import { SitesPanel } from './SitesPanel'

interface SiteOption { id: string; name: string; domain: string | null; isActive: boolean; visitorCount: number }
interface Visitor {
  id: string; siteId: string; firstSeenAt: string; lastSeenAt: string; visitCount: number; pageviewCount: number
  firstChannel: string | null; firstUtmSource: string | null; firstUtmCampaign: string | null; firstLanding: string | null
  deviceType: string | null; os: string | null; browser: string | null; region: string | null; city: string | null; isp: string | null
  leadId: string | null; leadName: string | null; keyActions: number
}
interface TrackEvent { id: string; type: string; path: string | null; title: string | null; durationMs: number | null; scrollPct: number | null; createdAt: string }
interface Visit {
  id: string; startedAt: string; endedAt: string; pageviews: number; durationSec: number; landingPath: string | null
  referrer: string | null; channel: string | null; utmSource: string | null; utmCampaign: string | null; clickIdType: string | null
  deviceType: string | null; os: string | null; browser: string | null; screen: string | null; network: string | null
  region: string | null; city: string | null; isp: string | null; events: TrackEvent[]
}

const CHANNELS = ['paid', 'search', 'social', 'referral', 'direct'] as const
const PAGE_SIZE = 30
const selectCls = 'rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700'

function duration(sec: number) {
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  return m < 60 ? `${m}m${sec % 60 ? ` ${sec % 60}s` : ''}` : `${Math.floor(m / 60)}h ${m % 60}m`
}
const place = (v: { region: string | null; city: string | null }) => [v.region, v.city].filter(Boolean).join(' ') || '—'

function JourneyDrawer({ siteId, visitorId, onClose }: { siteId: string; visitorId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['visitor-journey', siteId, visitorId],
    queryFn: () => crmApi.get<{ data: { visitor: Visitor; visits: Visit[] } }>(`/tracking/visitors/${siteId}/${visitorId}`).then((r) => r.data.data),
  })
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

function VisitorsPanel() {
  const { t } = useTranslation()
  const [siteId, setSiteId] = useState('')
  const [channel, setChannel] = useState('')
  const [withLead, setWithLead] = useState('')
  const [page, setPage] = useState(1)
  const [openVisitor, setOpenVisitor] = useState<string | null>(null)

  const { data: sites } = useQuery({
    queryKey: ['tracking-sites'],
    queryFn: () => crmApi.get<{ data: SiteOption[] }>('/tracking/sites').then((r) => r.data.data),
  })
  useEffect(() => { if (!siteId && sites?.length) setSiteId(sites[0]!.id) }, [sites, siteId])

  const { data, isLoading } = useQuery({
    queryKey: ['tracking-visitors', siteId, channel, withLead, page],
    enabled: !!siteId,
    queryFn: () => {
      const p = new URLSearchParams({ siteId, page: String(page), pageSize: String(PAGE_SIZE) })
      if (channel) p.set('channel', channel)
      if (withLead) p.set('withLead', withLead)
      return crmApi.get<{ data: Visitor[]; total: number }>(`/tracking/visitors?${p}`).then((r) => r.data)
    },
  })

  if (sites && sites.length === 0) {
    return <div className="rounded-lg border bg-white px-4 py-10 text-center text-sm text-gray-400">{t('analytics.visitors.noSites')}</div>
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <select className={selectCls} value={siteId} onChange={(e) => { setSiteId(e.target.value); setPage(1) }}>
          {(sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className={selectCls} value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1) }}>
          <option value="">{t('analytics.visitors.allChannels')}</option>
          {CHANNELS.map((c) => <option key={c} value={c}>{t(`analytics.channels.${c}`)}</option>)}
        </select>
        <select className={selectCls} value={withLead} onChange={(e) => { setWithLead(e.target.value); setPage(1) }}>
          <option value="">{t('analytics.visitors.allVisitors')}</option>
          <option value="true">{t('analytics.visitors.withLead')}</option>
          <option value="false">{t('analytics.visitors.withoutLead')}</option>
        </select>
        {data && <span className="ml-auto text-xs text-gray-400">{t('analytics.visitors.total', { count: data.total })}</span>}
      </div>
      {isLoading || !siteId ? (
        <div className="px-4 py-6 text-sm text-gray-400">{t('common.loading')}</div>
      ) : !data?.data.length ? (
        <div className="px-4 py-10 text-center text-sm text-gray-400">{t('analytics.visitors.empty')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50">
              <tr>
                {(['lastSeen', 'source', 'visits', 'device', 'location', 'actions', 'lead'] as const).map((c) => (
                  <th key={c} className="whitespace-nowrap px-4 py-2 text-left font-medium text-gray-700">{t(`analytics.visitors.cols.${c}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.data.map((v) => (
                <tr key={v.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setOpenVisitor(v.id)}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">{formatDate(v.lastSeenAt)}</td>
                  <td className="px-4 py-2.5">
                    <span className="text-gray-800">{v.firstChannel ? t(`analytics.channels.${v.firstChannel}`, { defaultValue: v.firstChannel }) : '—'}</span>
                    {(v.firstUtmSource || v.firstUtmCampaign) && <span className="block text-xs text-gray-400">{[v.firstUtmSource, v.firstUtmCampaign].filter(Boolean).join(' / ')}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">{v.visitCount} / {v.pageviewCount}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">{[v.deviceType && t(`analytics.devices.${v.deviceType}`), v.browser].filter(Boolean).join(' · ')}</td>
                  <td className="px-4 py-2.5 text-gray-600">{place(v)}{v.isp && <span className="block text-xs text-gray-400">{v.isp}</span>}</td>
                  <td className="px-4 py-2.5">{v.keyActions > 0 ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">{v.keyActions}</span> : <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-2.5">{v.leadId
                    ? <Link className="text-primary-600 hover:underline" to={`/app/leads/${v.leadId}`} onClick={(e) => e.stopPropagation()}>{v.leadName ?? t('analytics.journey.viewLead')}</Link>
                    : <span className="text-gray-300">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <div className="px-4 pb-3">
          <Pagination page={page} totalPages={Math.ceil(data.total / PAGE_SIZE)} total={data.total} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </div>
      )}
      {openVisitor && <JourneyDrawer siteId={siteId} visitorId={openVisitor} onClose={() => setOpenVisitor(null)} />}
    </div>
  )
}

export default function AnalyticsPage() {
  const { t } = useTranslation()
  const { user } = useCrmAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const isAdmin = user?.role === 'admin'
  const tab = searchParams.get('tab') === 'sites' && isAdmin ? 'sites' : 'visitors'

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-gray-900 sm:text-xl">{t('analytics.title')}</h1>
        <p className="mt-0.5 text-sm text-gray-500">{t('analytics.subtitle')}</p>
      </div>
      {isAdmin && (
        <div className="mb-4 flex gap-1 border-b">
          {(['visitors', 'sites'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setSearchParams({ tab: k })}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${tab === k ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t(`analytics.tabs.${k}`)}
            </button>
          ))}
        </div>
      )}
      {tab === 'sites' ? <SitesPanel /> : <VisitorsPanel />}
    </div>
  )
}
