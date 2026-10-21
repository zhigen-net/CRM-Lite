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
import { AnomalyIcons, type Anomaly } from './AnomalyIcons'
import { CountryFlag } from './CountryFlag'
import { languageName } from './language'

interface SiteOption { id: string; name: string; domain: string | null; isActive: boolean; lastSeenAt: string | null }
interface Visitor {
  id: string; siteId: string; firstSeenAt: string; lastSeenAt: string; visitCount: number; pageviewCount: number
  firstChannel: string | null; firstUtmSource: string | null; firstUtmCampaign: string | null; firstLanding: string | null
  deviceType: string | null; os: string | null; browser: string | null; country: string | null; region: string | null; city: string | null; isp: string | null
  leadId: string | null; leadName: string | null; keyActions: number; lastIp: string | null
  anomalies?: Anomaly[]
  /** 最近一次访问的浏览器语言 */
  lastLanguage?: string | null
}
const CHANNELS = ['paid', 'search', 'social', 'referral', 'direct'] as const
const PAGE_SIZE = 30
/** 筛选下拉框：统一高度和箭头样式（不用各系统自带的样式，手机上排列整齐） */
function FilterSelect({ value, onChange, label, children }: { value: string; onChange: (v: string) => void; label: string; children: React.ReactNode }) {
  return (
    <div className="relative min-w-0">
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
        className="h-9 w-full min-w-0 appearance-none truncate rounded-md border border-gray-300 bg-white py-0 pl-2.5 pr-7 text-sm text-gray-700 shadow-sm sm:w-auto">
        {children}
      </select>
      <svg className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </div>
  )
}

function VisitorsPanel() {
  const { t, i18n } = useTranslation()
  const [siteId, setSiteId] = useState('')
  const [channel, setChannel] = useState('')
  const [withLead, setWithLead] = useState('')
  const [page, setPage] = useState(1)
  const [openVisitor, setOpenVisitor] = useState<string | null>(null)
  // 时间段：默认今天，可选「全部时间」
  const [range, setRange] = useDateRangeParam('today')

  const { data: sites } = useQuery({
    queryKey: ['tracking-sites'],
    queryFn: () => crmApi.get<{ data: SiteOption[] }>('/tracking/sites').then((r) => r.data.data),
  })
  // 默认选最近有数据的启用站点
  useEffect(() => {
    if (siteId || !sites?.length) return
    const best = [...sites].sort((a, b) => Number(b.isActive) - Number(a.isActive) || (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''))[0]!
    setSiteId(best.id)
  }, [sites, siteId])

  const { data, isLoading } = useQuery({
    queryKey: ['tracking-visitors', siteId, channel, withLead, range.from, range.to, page],
    enabled: !!siteId,
    queryFn: () => {
      const p = new URLSearchParams({ siteId, page: String(page), pageSize: String(PAGE_SIZE) })
      if (channel) p.set('channel', channel)
      if (withLead) p.set('withLead', withLead)
      if (range.from && range.to) { p.set('from', range.from); p.set('to', range.to) }
      return crmApi.get<{ data: Visitor[]; total: number; summary?: { withLead: number; withActions: number } }>(`/tracking/visitors?${p}`).then((r) => r.data)
    },
  })

  if (sites && sites.length === 0) {
    return (
      <>
        <h1 className="mb-4 text-lg font-semibold text-gray-900 sm:mb-5 sm:text-xl">{t('analytics.title')}</h1>
        <div className="rounded-lg border bg-white px-4 py-10 text-center text-sm text-gray-400">
          {t('analytics.visitors.noSites')}{' '}
          <Link to="/app/ai-access?tab=sites" className="text-primary-600 hover:underline">{t('analytics.visitors.goSites')}</Link>
        </div>
      </>
    )
  }

  const siteName = sites?.find((x) => x.id === siteId)?.name
  const rangeLabel = range.preset === 'custom' ? `${range.from} ~ ${range.to}` : t(`dateRange.presets.${range.preset}`)
  return (
    <>
    <div className="mb-4 sm:mb-5">
      <h1 className="text-lg font-semibold text-gray-900 sm:text-xl">{t('analytics.title')}</h1>
      {/* 统计总结：随时间段、站点和筛选条件变化 */}
      <p className="mt-0.5 text-sm text-gray-500">
        {data && siteName
          ? t('analytics.summary', { range: rangeLabel, site: siteName, total: data.total, leads: data.summary?.withLead ?? 0, actions: data.summary?.withActions ?? 0 })
          : '\u00a0'}
      </p>
    </div>
    <div className="overflow-hidden rounded-lg border bg-white">
      {/* 筛选：第一行时间段；第二行三个下拉框，手机上等宽排成一行（总数在页面标题下的统计总结里） */}
      <div className="space-y-2 border-b px-3 py-3 sm:flex sm:flex-wrap sm:items-center sm:gap-2 sm:space-y-0 sm:px-4">
        <DateRangePicker value={range} onChange={(v) => { setRange(v); setPage(1) }} allowAll />
        <div className="grid grid-cols-3 gap-2 sm:contents">
          <FilterSelect value={siteId} onChange={(v) => { setSiteId(v); setPage(1) }} label={t('analytics.visitors.site')}>
            {(sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </FilterSelect>
          <FilterSelect value={channel} onChange={(v) => { setChannel(v); setPage(1) }} label={t('analytics.visitors.allChannels')}>
            <option value="">{t('analytics.visitors.allChannels')}</option>
            {CHANNELS.map((c) => <option key={c} value={c}>{t(`analytics.channels.${c}`)}</option>)}
          </FilterSelect>
          <FilterSelect value={withLead} onChange={(v) => { setWithLead(v); setPage(1) }} label={t('analytics.visitors.allVisitors')}>
            <option value="">{t('analytics.visitors.allVisitors')}</option>
            <option value="true">{t('analytics.visitors.withLead')}</option>
            <option value="false">{t('analytics.visitors.withoutLead')}</option>
          </FilterSelect>
        </div>
      </div>
      {isLoading || !siteId ? (
        <div className="px-4 py-6 text-sm text-gray-400">{t('common.loading')}</div>
      ) : !data?.data.length ? (
        <div className="px-4 py-10 text-center text-sm text-gray-400">{t('analytics.visitors.empty')}</div>
      ) : (
        <>
        {/* 手机：卡片列表 */}
        <ul className="divide-y divide-gray-100 sm:hidden">
          {data.data.map((v) => (
            <li key={v.id}>
              <div role="button" tabIndex={0} onClick={() => setOpenVisitor(v.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpenVisitor(v.id) }}
                className="block w-full cursor-pointer px-3 py-3 text-left active:bg-gray-50">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-900">{v.firstChannel ? t(`analytics.channels.${v.firstChannel}`, { defaultValue: v.firstChannel }) : '—'}
                    {(v.firstUtmSource || v.firstUtmCampaign) && <span className="ml-1 text-xs font-normal text-gray-400">{[v.firstUtmSource, v.firstUtmCampaign].filter(Boolean).join(' / ')}</span>}
                    <span className="ml-1"><AnomalyIcons items={v.anomalies} /></span>
                  </span>
                  <span className="shrink-0 text-xs text-gray-400">{formatDate(v.lastSeenAt)}</span>
                </div>
                <p className="mt-1 flex items-center gap-1 truncate text-xs text-gray-500">
                  <CountryFlag code={v.country} />
                  {[v.deviceType && t(`analytics.devices.${v.deviceType}`), v.browser, place(v), v.lastIp].filter(Boolean).join(' · ')}
                </p>
                <div className="mt-1.5 flex items-center gap-2 text-xs">
                  <span className="shrink-0 whitespace-nowrap text-gray-500">{v.visitCount} / {v.pageviewCount}</span>
                  {v.lastLanguage && <span className="min-w-0 truncate text-gray-400" title={v.lastLanguage}>{languageName(v.lastLanguage, i18n.language)}</span>}
                  {v.keyActions > 0 && <span className="shrink-0 whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">{t('analytics.visitors.cols.actions')} {v.keyActions}</span>}
                  {v.leadId && <span className="ml-auto max-w-[40%] shrink-0 truncate whitespace-nowrap rounded bg-green-50 px-1.5 py-0.5 text-green-700">{v.leadName ?? t('analytics.journey.viewLead')}</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto sm:block">
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
                  <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                    {[v.deviceType && t(`analytics.devices.${v.deviceType}`), v.browser].filter(Boolean).join(' · ')}
                    {v.lastLanguage && <span className="block text-xs text-gray-400" title={v.lastLanguage}>{languageName(v.lastLanguage, i18n.language)}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {(v.lastIp || !!v.anomalies?.length) && (
                      <span className="flex items-center gap-1 font-mono text-xs text-gray-700">{v.lastIp}<AnomalyIcons items={v.anomalies} /></span>
                    )}
                    <span className="inline-flex items-center gap-1"><CountryFlag code={v.country} />{place(v)}</span>
                    {v.isp && <span className="block text-xs text-gray-400">{v.isp}</span>}
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
        </>
      )}
      {data && (
        <div className="px-3 pb-3 sm:px-4">
          <Pagination page={page} totalPages={Math.ceil(data.total / PAGE_SIZE)} total={data.total} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </div>
      )}
      {openVisitor && <JourneyDrawer url={`/tracking/visitors/${siteId}/${openVisitor}`} onClose={() => setOpenVisitor(null)} />}
    </div>
    </>
  )
}

export default function AnalyticsPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  // 站点管理已移到「接入 → 网站」，旧链接自动跳转
  if (searchParams.get('tab') === 'sites') return <Navigate to="/app/ai-access?tab=sites" replace />

  return (
    <div className="p-4 sm:p-6">
      <VisitorsPanel />
    </div>
  )
}
