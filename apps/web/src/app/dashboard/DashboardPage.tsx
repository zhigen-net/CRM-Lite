// 仪表盘：所选时间段内的线索、客户、跟进、访客概况；销售只看自己的，访客与团队排行只给管理员、运营
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { crmApi } from '@/shared/utils/request'
import { useCrmAuth } from '@/app/auth/CrmAuthContext'
import { getOptionLabel, useOptionGroup } from '@/shared/hooks/useOptions'
import { DateRangePicker, useDateRangeParam } from '@/shared/components/DateRangePicker'
import { cn } from '@/shared/utils/cn'
import { BarChart } from './BarChart'

interface Metric { value: number; prev: number }
interface Dashboard {
  range: { from: string; to: string; days: string[] }
  source: string | null
  visitorSite: string | null
  kpis: { newLeads: Metric; newClients: Metric; convertedLeads: number; followups: Metric; visitors?: Metric; siteLeads?: number }
  trend: { day: string; leads: number; visitors?: number }[]
  sources: { source: string; count: number }[]
  statuses: { status: string; count: number }[]
  todo: { overdueLeads: number; todayLeads: number; overdueClients: number; todayClients: number }
  leaderboard?: { userId: string; name: string; leads: number; followups: number; clients: number }[]
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0)

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border bg-white', className)}>
      <h2 className="border-b px-3 py-2.5 text-sm font-medium text-gray-900 sm:px-4 sm:py-3">{title}</h2>
      <div className="p-3 sm:p-4">{children}</div>
    </section>
  )
}

/** 指标卡：数值 + 与上一个等长周期相比的变化 */
function StatTile({ label, value, prev, hint }: { label: string; value: string | number; prev?: Metric; hint?: string }) {
  const { t } = useTranslation()
  let delta: React.ReactNode = null
  if (prev) {
    const diff = prev.value - prev.prev
    const rate = prev.prev > 0 ? Math.round((diff / prev.prev) * 100) : null
    const text = diff === 0 ? t('dashboard.flat') : `${diff > 0 ? '↑' : '↓'} ${rate !== null ? `${Math.abs(rate)}%` : Math.abs(diff)}`
    delta = (
      <span className={cn('text-xs', diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-500' : 'text-gray-400')}>
        {text} <span className="hidden text-gray-400 sm:inline">{t('dashboard.vsPrev')}</span>
      </span>
    )
  }
  return (
    <div className="min-w-0 rounded-lg border bg-white p-2.5 sm:p-4">
      <p className="truncate text-xs text-gray-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-gray-900 sm:mt-1 sm:text-2xl">{value}</p>
      <p className="mt-0.5 min-h-[1rem] truncate sm:mt-1">{delta ?? <span className="text-xs text-gray-400">{hint}</span>}</p>
    </div>
  )
}

/** 横向条形列表：名称、数值，条长按最大值比例 */
function BarList({ rows }: { rows: { label: string; count: number }[] }) {
  const { t } = useTranslation()
  if (!rows.length) return <p className="py-6 text-center text-sm text-gray-400">{t('dashboard.noData')}</p>
  const max = Math.max(...rows.map((r) => r.count))
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="mb-1 flex justify-between gap-2">
            <span className="truncate text-gray-700">{r.label}</span>
            <span className="font-medium text-gray-900">{r.count}</span>
          </div>
          <div className="h-1.5 rounded-full bg-primary-50">
            <div className="h-1.5 rounded-full bg-primary-500" style={{ width: `${Math.max(2, (r.count / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function DashboardPage() {
  const { t } = useTranslation()
  const { user } = useCrmAuth()
  const staff = user?.role !== 'sales'
  const [range, setRange] = useDateRangeParam('7d')
  // 按线索来源筛选（地址栏 ?source=）；来源是某个网站时访客也只统计这个网站
  const [params, setParams] = useSearchParams()
  const source = params.get('source') ?? ''
  const setSource = (v: string) => setParams((p) => { if (v) p.set('source', v); else p.delete('source'); return p }, { replace: true })
  const { data: sources } = useQuery({
    queryKey: ['lead-sources'],
    queryFn: () => crmApi.get<{ data: string[] }>('/leads/sources').then((r) => r.data.data),
  })
  const { options: statusOpts } = useOptionGroup('lead_status')

  const { data, isFetching, isError } = useQuery({
    queryKey: ['dashboard', range.from, range.to, source],
    queryFn: () => crmApi.get<{ data: Dashboard }>(`/dashboard?${new URLSearchParams({ from: range.from, to: range.to, ...(source ? { source } : {}) })}`).then((r) => r.data.data),
    // 切换时间段时保留上一次的结果（半透明），不闪烁
    placeholderData: keepPreviousData,
  })

  const k = data?.kpis
  // 有访客数据时，新增线索和网站访客画在同一张图里（共用纵轴，可点图例隐藏某一项）
  const hasVisitors = staff && data?.trend[0]?.visitors !== undefined
  const todoItems = data ? [
    { key: 'overdueLeads', n: data.todo.overdueLeads, to: '/app/leads?nextContact=overdue', tone: 'red' },
    { key: 'todayLeads', n: data.todo.todayLeads, to: '/app/leads?nextContact=today', tone: 'amber' },
    { key: 'overdueClients', n: data.todo.overdueClients, to: '/app/clients?nextContact=overdue', tone: 'red' },
    { key: 'todayClients', n: data.todo.todayClients, to: '/app/clients?nextContact=today', tone: 'amber' },
  ] : []

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-3 sm:mb-4">
        <h1 className="text-lg font-semibold text-gray-900 sm:text-xl">{t('dashboard.title')}</h1>
        <p className="mt-0.5 hidden text-sm text-gray-500 sm:block">{t(staff ? 'dashboard.subtitle' : 'dashboard.subtitleSales')}</p>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2 sm:mb-4">
        <DateRangePicker value={range} onChange={setRange} />
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label={t('dashboard.source')}
          className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 shadow-sm sm:max-w-[12rem] sm:flex-none">
          <option value="">{t('dashboard.allSources')}</option>
          {(sources ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {isFetching && data && <span className="text-xs text-gray-400">{t('common.loading')}</span>}
      </div>

      {isError ? <p className="text-sm text-red-500">{t('common.opFailed')}</p> : !data || !k ? (
        <p className="text-sm text-gray-400">{t('common.loading')}</p>
      ) : (
        <div className={cn('space-y-3 transition-opacity sm:space-y-4', isFetching && 'opacity-60')}>
          {/* 手机上 3 列（6 个指标两行），电脑上一行 */}
          <div className={cn('grid gap-2 sm:gap-3', staff ? 'grid-cols-3 lg:grid-cols-6' : 'grid-cols-2 lg:grid-cols-4')}>
            <StatTile label={t('dashboard.kpi.newLeads')} value={k.newLeads.value} prev={k.newLeads} />
            <StatTile label={t('dashboard.kpi.newClients')} value={k.newClients.value} prev={k.newClients} />
            <StatTile label={t('dashboard.kpi.conversion')} value={`${pct(k.convertedLeads, k.newLeads.value)}%`}
              hint={t('dashboard.kpi.conversionHint', { converted: k.convertedLeads, total: k.newLeads.value })} />
            <StatTile label={t('dashboard.kpi.followups')} value={k.followups.value} prev={k.followups} />
            {staff && k.visitors && <>
              <StatTile label={t('dashboard.kpi.visitors')} value={k.visitors.value} prev={k.visitors} />
              <StatTile label={t('dashboard.kpi.siteRate')} value={`${pct(k.siteLeads ?? 0, k.visitors.value)}%`}
                hint={t('dashboard.kpi.siteRateHint', { leads: k.siteLeads ?? 0 })} />
            </>}
          </div>

          <div className="grid gap-3 sm:gap-4 lg:grid-cols-3">
            <Card title={t(hasVisitors ? 'dashboard.trend.both' : 'dashboard.trend.leads')} className="lg:col-span-2">
              <BarChart label={t(hasVisitors ? 'dashboard.trend.both' : 'dashboard.trend.leads')} data={data.trend}
                series={[
                  ...(hasVisitors ? [{ key: 'visitors', label: t('dashboard.kpi.visitors'), color: '#2a78d6' }] : []),
                  { key: 'leads', label: t('dashboard.kpi.newLeads'), color: '#eb6834' },
                ]} />
            </Card>
            {/* 手机上待跟进排在图表前面，打开就能看到要处理的事 */}
            <Card title={t('dashboard.todo.title')} className="order-first lg:order-none">
              <ul className="divide-y divide-gray-100">
                {todoItems.map((x) => (
                  <li key={x.key}>
                    <Link to={x.to} className="flex items-center justify-between py-2 text-sm hover:text-primary-700 sm:py-2.5">
                      <span className="text-gray-700">{t(`dashboard.todo.${x.key}`)}</span>
                      <span className={cn('min-w-[2rem] rounded-full px-2 py-0.5 text-center text-xs font-semibold',
                        x.n === 0 ? 'bg-gray-100 text-gray-400' : x.tone === 'red' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700')}>{x.n}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-gray-400">{t('dashboard.todo.hint')}</p>
            </Card>
          </div>

          <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
            <Card title={t('dashboard.sources')}>
              <BarList rows={data.sources.map((s) => ({ label: s.source === '__other__' ? t('dashboard.other') : s.source, count: s.count }))} />
            </Card>
            <Card title={t('dashboard.statuses')}>
              <BarList rows={data.statuses.map((s) => ({ label: getOptionLabel(statusOpts, s.status), count: s.count }))} />
            </Card>
          </div>

          {staff && data.leaderboard && (
            <Card title={t('dashboard.leaderboard.title')}>
              {!data.leaderboard.length ? <p className="py-4 text-center text-sm text-gray-400">{t('dashboard.noData')}</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-gray-500">
                        {(['name', 'leads', 'followups', 'clients'] as const).map((c) => (
                          <th key={c} className={cn('whitespace-nowrap px-2 py-2 font-medium', c !== 'name' && 'text-right')}>{t(`dashboard.leaderboard.${c}`)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.leaderboard.map((r) => (
                        <tr key={r.userId}>
                          <td className="px-2 py-2 text-gray-800">{r.name}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-gray-700">{r.leads}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-gray-700">{r.followups}</td>
                          <td className="px-2 py-2 text-right tabular-nums font-medium text-gray-900">{r.clients}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
