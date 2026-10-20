// 浏览事件明细的手动清理（管理员）：先查询早于 N 天的条数，确认后分批删除
// 只删每一页的浏览、点击明细；访问、访客汇总（来源、落地页、IP、线索关联）都保留
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { crmApi } from '@/shared/utils/request'
import { formatDate } from '@/shared/utils/format'
import { Button } from '@/shared/components/Button'

const DAYS = [90, 180, 365, 730] as const
interface Stats { total: number; oldest: string | null; older: number; cutoff: string }

export function EventsCleanupPanel() {
  const { t } = useTranslation()
  const [days, setDays] = useState<number>(180)
  const [stats, setStats] = useState<Stats | null>(null)
  const [result, setResult] = useState<{ deleted: number; remaining: number } | null>(null)

  const check = useMutation({
    mutationFn: () => crmApi.get<{ data: Stats }>(`/admin/tracking-sites/events-stats?days=${days}`).then((r) => r.data.data),
    onSuccess: (d) => { setStats(d); setResult(null) },
  })
  const purge = useMutation({
    mutationFn: () => crmApi.post<{ data: { deleted: number; remaining: number } }>('/admin/tracking-sites/purge-events', { days }).then((r) => r.data.data),
    onSuccess: (d) => { setResult((prev) => ({ deleted: (prev?.deleted ?? 0) + d.deleted, remaining: d.remaining })); setStats((s) => (s ? { ...s, older: d.remaining, total: s.total - d.deleted } : s)) },
  })
  const run = () => { if (confirm(t('eventCleanup.confirm', { count: stats?.older ?? 0, days }))) purge.mutate() }

  return (
    <details className="rounded-lg border bg-white">
      <summary className="cursor-pointer px-4 py-3">
        <span className="text-sm font-medium text-gray-900">{t('eventCleanup.title')}</span>
        <span className="ml-2 text-xs text-gray-500">{t('eventCleanup.subtitle')}</span>
      </summary>
      <div className="space-y-3 border-t px-4 py-4 text-sm">
        <p className="text-xs text-gray-500">{t('eventCleanup.hint')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-gray-700">{t('eventCleanup.keep')}</span>
          <select value={days} onChange={(e) => { setDays(Number(e.target.value)); setStats(null); setResult(null) }}
            className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700">
            {DAYS.map((d) => <option key={d} value={d}>{t('eventCleanup.days', { count: d })}</option>)}
          </select>
          <Button size="sm" variant="secondary" loading={check.isPending} onClick={() => check.mutate()}>{t('eventCleanup.check')}</Button>
        </div>
        {stats && (
          <div className="rounded-md bg-gray-50 p-3 text-xs text-gray-600">
            <p>{t('eventCleanup.stats', { total: stats.total, oldest: stats.oldest ? formatDate(stats.oldest) : '—' })}</p>
            <p className="mt-1">{t('eventCleanup.older', { days, count: stats.older })}</p>
            {stats.older > 0 && (
              <Button size="sm" variant="danger" className="mt-2" loading={purge.isPending} onClick={run}>
                {result ? t('eventCleanup.continue') : t('eventCleanup.purge')}
              </Button>
            )}
          </div>
        )}
        {result && <p className="text-xs text-green-700">{t('eventCleanup.done', { deleted: result.deleted, remaining: result.remaining })}</p>}
        {(check.isError || purge.isError) && <p className="text-xs text-red-500">{t('common.opFailed')}</p>}
      </div>
    </details>
  )
}
