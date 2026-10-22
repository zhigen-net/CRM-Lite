// 仪表盘与网站数据分析共用的卡片、指标卡
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/utils/cn'

export interface Metric { value: number; prev: number }

export function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0 rounded-lg border bg-white', className)}>
      <h2 className="border-b px-3 py-2.5 text-sm font-medium text-gray-900 sm:px-4 sm:py-3">{title}</h2>
      <div className="p-3 sm:p-4">{children}</div>
    </section>
  )
}

/** 指标卡：数值 + 与上一个等长周期相比的变化 */
export function StatTile({ label, value, prev, hint }: { label: string; value: string | number; prev?: Metric; hint?: string }) {
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

