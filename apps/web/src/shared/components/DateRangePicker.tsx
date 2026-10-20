// 时间段选择：常用区间（今天、近 7 天、本月……）一行一个，底部可自定义起止日期
// 日期按「系统设置 → 时区」的自然日计算，传给接口的是 from / to（YYYY-MM-DD，含首尾）
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { todayInApp } from '@/shared/utils/format'
import { cn } from '@/shared/utils/cn'

export const RANGE_PRESETS = ['today', 'yesterday', '7d', '30d', '90d', 'thisMonth', 'lastMonth'] as const
export type RangePreset = typeof RANGE_PRESETS[number] | 'custom' | 'all'
export interface DateRangeValue { preset: RangePreset; from: string; to: string }

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 常用区间对应的起止日期；all 表示不限时间 */
export function presetRange(preset: RangePreset): DateRangeValue {
  const today = todayInApp()
  const month = today.slice(0, 8)
  switch (preset) {
    case 'today': return { preset, from: today, to: today }
    case 'yesterday': return { preset, from: addDays(today, -1), to: addDays(today, -1) }
    case '30d': return { preset, from: addDays(today, -29), to: today }
    case '90d': return { preset, from: addDays(today, -89), to: today }
    case 'thisMonth': return { preset, from: `${month}01`, to: today }
    case 'lastMonth': {
      const lastDay = addDays(`${month}01`, -1)
      return { preset, from: `${lastDay.slice(0, 8)}01`, to: lastDay }
    }
    case 'all': return { preset, from: '', to: '' }
    default: return { preset: '7d', from: addDays(today, -6), to: today }
  }
}

/** 时间段记在地址栏（?range=7d 或 ?from=&to=），刷新、分享链接后保持不变 */
export function useDateRangeParam(defaultPreset: RangePreset = '7d'): [DateRangeValue, (v: DateRangeValue) => void] {
  const [params, setParams] = useSearchParams()
  const from = params.get('from') ?? '', to = params.get('to') ?? ''
  const range = params.get('range') as RangePreset | null
  const value = DATE_RE.test(from) && DATE_RE.test(to) && from <= to
    ? { preset: 'custom' as const, from, to }
    : presetRange(range && (RANGE_PRESETS as readonly string[]).concat('all').includes(range) ? range : defaultPreset)
  const set = (v: DateRangeValue) => setParams((p) => {
    p.delete('range'); p.delete('from'); p.delete('to')
    if (v.preset === 'custom') { p.set('from', v.from); p.set('to', v.to) } else if (v.preset !== defaultPreset) p.set('range', v.preset)
    p.delete('page')
    return p
  }, { replace: true })
  return [value, set]
}

const short = (d: string) => d.slice(5)

export function DateRangePicker({ value, onChange, allowAll = false }: {
  value: DateRangeValue; onChange: (v: DateRangeValue) => void; allowAll?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState({ from: value.from, to: value.to })
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setCustom({ from: value.from || addDays(todayInApp(), -6), to: value.to || todayInApp() })
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, value.from, value.to])

  const presets: RangePreset[] = allowAll ? ['all', ...RANGE_PRESETS] : [...RANGE_PRESETS]
  const label = value.preset === 'custom' ? t('dateRange.custom') : t(`dateRange.presets.${value.preset}`)
  const dates = value.preset === 'all' ? '' : value.from === value.to ? short(value.from) : `${short(value.from)} ~ ${short(value.to)}`
  const customValid = DATE_RE.test(custom.from) && DATE_RE.test(custom.to) && custom.from <= custom.to

  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-700 shadow-sm hover:border-gray-400">
        <svg className="h-4 w-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 2v4 M16 2v4 M3 10h18" /><rect x="3" y="4" width="18" height="18" rx="2" />
        </svg>
        <span className="font-medium">{label}</span>
        {dates && <span className="text-gray-400">{dates}</span>}
        <svg className="h-3.5 w-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-lg border bg-white py-1 shadow-lg" role="listbox">
          {presets.map((p) => (
            <button key={p} type="button" role="option" aria-selected={value.preset === p}
              onClick={() => { onChange(presetRange(p)); setOpen(false) }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50">
              <span className="w-4 text-primary-600">{value.preset === p ? <b>✓</b> : null}</span>
              <span className={cn(value.preset === p && 'font-medium text-gray-900')}>{t(`dateRange.presets.${p}`)}</span>
            </button>
          ))}
          <div className="mt-1 space-y-2 border-t px-3 pb-2 pt-2">
            <p className="text-xs font-medium text-gray-500">{t('dateRange.custom')}</p>
            <div className="flex items-center gap-1.5">
              <input type="date" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom({ ...custom, from: e.target.value })}
                className="min-w-0 flex-1 rounded border border-gray-300 px-1.5 py-1 text-xs" aria-label={t('dateRange.from')} />
              <span className="text-xs text-gray-400">~</span>
              <input type="date" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom({ ...custom, to: e.target.value })}
                className="min-w-0 flex-1 rounded border border-gray-300 px-1.5 py-1 text-xs" aria-label={t('dateRange.to')} />
            </div>
            <button type="button" disabled={!customValid}
              onClick={() => { onChange({ preset: 'custom', from: custom.from, to: custom.to }); setOpen(false) }}
              className="w-full rounded-md bg-primary-600 py-1 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-40">{t('dateRange.apply')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
