// 访客分析：按时间段、站点、来源筛选访客，查看访问轨迹
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { crmApi } from '@/shared/utils/request'
import { formatDate } from '@/shared/utils/format'
import { Pagination } from '@/shared/components/Pagination'
import { DateRangePicker, useDateRangeParam } from '@/shared/components/DateRangePicker'
import { JourneyDrawer, place } from './Journey'

interface SiteOption { id: string; name: string; domain: string | null; isActive: boolean; visitorCount: number }
interface Visitor {
  id: string; siteId: string; firstSeenAt: string; lastSeenAt: string; visitCount: number; pageviewCount: number
  firstChannel: string | null; firstUtmSource: string | null; firstUtmCampaign: string | null; firstLanding: string | null
  deviceType: string | null; os: string | null; browser: string | null; region: string | null; city: string | null; isp: string | null
  leadId: string | null; leadName: string | null; keyActions: number; lastIp: string | null
}
const CHANNELS = ['paid', 'search', 'social', 'referral', 'direct'] as const
const PAGE_SIZE = 30
const selectCls = 'rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700'

function VisitorsPanel() {
  const { t } = useTranslation()
  const [siteId, setSiteId] = useState('')
  const [channel, setChannel] = useState('')
  const [withLead, setWithLead] = useState('')
  const [page, setPage] = useState(1)
  const [openVisitor, setOpenVisitor] = useState<string | null>(null)
  // 时间段：默认不限，选择后只看该时间段内有访问的访客
  const [range, setRange] = useDateRangeParam('all')

  const { data: sites } = useQuery({
    queryKey: ['tracking-sites'],
    queryFn: () => crmApi.get<{ data: SiteOption[] }>('/tracking/sites').then((r) => r.data.data),
  })
  useEffect(() => { if (!siteId && sites?.length) setSiteId(sites[0]!.id) }, [sites, siteId])

  const { data, isLoading } = useQuery({
    queryKey: ['tracking-visitors', siteId, channel, withLead, range.from, range.to, page],
    enabled: !!siteId,
    queryFn: () => {
      const p = new URLSearchParams({ siteId, page: String(page), pageSize: String(PAGE_SIZE) })
      if (channel) p.set('channel', channel)
      if (withLead) p.set('withLead', withLead)
      if (range.from && range.to) { p.set('from', range.from); p.set('to', range.to) }
      return crmApi.get<{ data: Visitor[]; total: number }>(`/tracking/visitors?${p}`).then((r) => r.data)
    },
  })

  if (sites && sites.length === 0) {
    return (
      <div className="rounded-lg border bg-white px-4 py-10 text-center text-sm text-gray-400">
        {t('analytics.visitors.noSites')}{' '}
        <Link to="/app/ai-access?tab=sites" className="text-primary-600 hover:underline">{t('analytics.visitors.goSites')}</Link>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <DateRangePicker value={range} onChange={(v) => { setRange(v); setPage(1) }} allowAll />
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
                  <td className="px-4 py-2.5 text-gray-600">
                    {v.lastIp && <span className="block font-mono text-xs text-gray-700">{v.lastIp}</span>}
                    {place(v)}{v.isp && <span className="block text-xs text-gray-400">{v.isp}</span>}
                  </td>
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
      {openVisitor && <JourneyDrawer url={`/tracking/visitors/${siteId}/${openVisitor}`} onClose={() => setOpenVisitor(null)} />}
    </div>
  )
}

export default function AnalyticsPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  // 站点管理已移到「接入 → 网站」，旧链接自动跳转
  if (searchParams.get('tab') === 'sites') return <Navigate to="/app/ai-access?tab=sites" replace />

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-gray-900 sm:text-xl">{t('analytics.title')}</h1>
        <p className="mt-0.5 text-sm text-gray-500">{t('analytics.subtitle')}</p>
      </div>
      <VisitorsPanel />
    </div>
  )
}
