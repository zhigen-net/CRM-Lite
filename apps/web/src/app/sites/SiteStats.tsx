// 网站数据分析（「接入 → 网站」抽屉的概览）：所选时间段的访客、访问、留资、来源、页面、设备、地区、关键行为
import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { crmApi } from '@/shared/utils/request'
import { DateRangePicker, presetRange, type DateRangeValue } from '@/shared/components/DateRangePicker'
import { BarChart } from '@/app/dashboard/BarChart'
import { Card, StatTile, type Metric } from '@/app/dashboard/Widgets'
import { CountryFlag, countryName } from '@/app/analytics/CountryFlag'
import { duration } from '@/app/analytics/Journey'
import { sourceDetail } from '@/app/analytics/source'

interface SiteStatsData {
  kpis: { visitors: Metric; visits: number; pageviews: number; avgDurationSec: number; bounceRate: number; leads: Metric }
  trend: { day: string; visitors: number; leads: number }[]
  channels: { channel: string; visits: number }[]
  sources: { channel: string; host: string | null; clickIdType: string | null; utmSource: string | null; utmCampaign: string | null; visits: number }[]
  landings: { host: string | null; path: string; visits: number }[]
  pages: { path: string; views: number }[]
  devices: { device: string; visits: number }[]
  countries: { country: string; visits: number }[]
  actions: { type: string; count: number }[]
}

/** 排行列表：名称 + 数量 + 占比条 */
function RankList({ rows, empty }: { rows: { key: string; label: React.ReactNode; title?: string; value: number }[]; empty: string }) {
  if (rows.length === 0) return <p className="py-4 text-center text-xs text-gray-400">{empty}</p>
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.key} className="text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-gray-700" title={r.title}>{r.label}</span>
            <span className="shrink-0 tabular-nums text-gray-500">{r.value}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-gray-100">
            <div className="h-1.5 rounded-full bg-primary-500/70" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`

export function SiteStats({ siteId }: { siteId: string }) {
  const { t, i18n } = useTranslation()
  const [range, setRange] = useState<DateRangeValue>(() => presetRange('7d'))
  const { data, isLoading } = useQuery({
    queryKey: ['site-stats', siteId, range.from, range.to],
    queryFn: () => crmApi.get<{ data: SiteStatsData }>(`/admin/tracking-sites/${siteId}/stats`, { params: { from: range.from, to: range.to } })
      .then((r) => r.data.data),
    placeholderData: keepPreviousData,
  })
  const empty = t('siteConnect.stats.empty')
  const ch = (c: string) => t(`analytics.channels.${c}`, { defaultValue: c })

  return (
    <div className="space-y-3 sm:space-y-4">
      <DateRangePicker value={range} onChange={setRange} />
      {isLoading || !data ? <p className="text-sm text-gray-400">{t('common.loading')}</p> : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
            <StatTile label={t('siteConnect.stats.visitors')} value={data.kpis.visitors.value} prev={data.kpis.visitors} />
            <StatTile label={t('siteConnect.stats.leads')} value={data.kpis.leads.value} prev={data.kpis.leads} />
            <StatTile label={t('siteConnect.stats.conversion')}
              value={data.kpis.visitors.value > 0 ? pct(data.kpis.leads.value / data.kpis.visitors.value) : '—'}
              hint={t('siteConnect.stats.conversionHint')} />
            <StatTile label={t('siteConnect.stats.visitsPageviews')} value={`${data.kpis.visits} / ${data.kpis.pageviews}`}
              hint={t('siteConnect.stats.perVisit', { n: data.kpis.visits > 0 ? (data.kpis.pageviews / data.kpis.visits).toFixed(1) : 0 })} />
            <StatTile label={t('siteConnect.stats.avgDuration')} value={duration(data.kpis.avgDurationSec)} hint={t('siteConnect.stats.avgDurationHint')} />
            <StatTile label={t('siteConnect.stats.bounce')} value={data.kpis.visits > 0 ? pct(data.kpis.bounceRate) : '—'} hint={t('siteConnect.stats.bounceHint')} />
          </div>

          <Card title={t('siteConnect.stats.trend')}>
            <BarChart label={t('siteConnect.stats.trend')} data={data.trend} series={[
              { key: 'visitors', label: t('siteConnect.stats.visitors'), color: '#2a78d6' },
              { key: 'leads', label: t('siteConnect.stats.leads'), color: '#eb6834' },
            ]} />
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
            <Card title={t('siteConnect.stats.sources')}>
              <RankList empty={empty} rows={data.sources.map((s, i) => {
                const detail = sourceDetail(t, { channel: s.channel, referrer: s.host ? `https://${s.host}/` : null, clickIdType: s.clickIdType, utmSource: s.utmSource, utmCampaign: s.utmCampaign })
                const label = [ch(s.channel), detail].filter(Boolean).join(' · ')
                return { key: String(i), label, title: label, value: s.visits }
              })} />
            </Card>
            <Card title={t('siteConnect.stats.channels')}>
              <RankList empty={empty} rows={data.channels.map((c) => ({ key: c.channel, label: ch(c.channel), value: c.visits }))} />
            </Card>
            <Card title={t('siteConnect.stats.landings')}>
              <RankList empty={empty} rows={data.landings.map((l, i) => ({ key: String(i), label: <span className="font-mono text-xs">{l.path}</span>, title: `${l.host ?? ''}${l.path}`, value: l.visits }))} />
            </Card>
            <Card title={t('siteConnect.stats.pages')}>
              <RankList empty={t('siteConnect.stats.pagesEmpty')} rows={data.pages.map((p) => ({ key: p.path, label: <span className="font-mono text-xs">{p.path}</span>, title: p.path, value: p.views }))} />
            </Card>
            <Card title={t('siteConnect.stats.countries')}>
              <RankList empty={empty} rows={data.countries.map((c) => ({
                key: c.country || '-',
                label: c.country ? <span className="inline-flex items-center gap-1.5"><CountryFlag code={c.country} />{countryName(c.country, i18n.language)}</span> : t('siteConnect.stats.unknown'),
                value: c.visits,
              }))} />
            </Card>
            <Card title={t('siteConnect.stats.devicesActions')}>
              <RankList empty={empty} rows={data.devices.map((d) => ({ key: d.device, label: t(`analytics.devices.${d.device}`, { defaultValue: t('siteConnect.stats.unknown') }), value: d.visits }))} />
              <p className="mb-2 mt-4 text-xs font-medium text-gray-500">{t('siteConnect.stats.actions')}</p>
              <RankList empty={t('siteConnect.stats.actionsEmpty')} rows={data.actions.map((a) => ({ key: a.type, label: t(`analytics.events.${a.type}`, { defaultValue: a.type }), value: a.count }))} />
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
