// 按天的分组柱状图（内联 SVG）：多个系列共用一个纵轴；图例可点击隐藏某个系列（纵轴随之重新取刻度）
// 悬停整列显示当天各系列的数值；附隐藏表格供读屏
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/utils/cn'

export interface Series { key: string; label: string; color: string }
const H = 190, PAD_L = 34, PAD_B = 22, PAD_T = 8, GAP = 2

/** 纵轴刻度：取整到 1 / 2 / 5 × 10^n */
function niceMax(v: number) {
  if (v <= 4) return Math.max(4, v)
  const p = 10 ** Math.floor(Math.log10(v))
  return [1, 2, 5, 10].map((m) => m * p).find((m) => m >= v) ?? v
}

/** 柱顶 4px 圆角、底部贴住基线 */
const barPath = (x: number, w: number, top: number, bottom: number) => {
  const r = Math.min(4, w / 2, bottom - top)
  return `M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${bottom} Z`
}

export function BarChart({ series, data, label }: {
  series: Series[]; data: ({ day: string } & Record<string, number | string>)[]; label: string
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [hover, setHover] = useState<number | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e!.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])

  const shown = series.filter((s) => !hidden.has(s.key))
  const val = (d: Record<string, number | string>, k: string) => Number(d[k] ?? 0)
  const max = niceMax(Math.max(0, ...data.flatMap((d) => shown.map((s) => val(d, s.key)))))
  const plotW = width - PAD_L, plotH = H - PAD_B - PAD_T
  const step = plotW / Math.max(1, data.length)
  const groupW = Math.max(1, Math.min(40, step - 4))
  const barW = Math.max(1, (groupW - GAP * (shown.length - 1)) / Math.max(1, shown.length))
  const y = (v: number) => PAD_T + plotH - (v / max) * plotH
  const every = Math.max(1, Math.ceil(data.length / (width < 480 ? 5 : 8)))
  const h = hover !== null ? data[hover] : null
  const toggle = (k: string) => setHidden((prev) => {
    const next = new Set(prev)
    if (next.has(k)) next.delete(k)
    else if (shown.length > 1) next.add(k) // 至少保留一个系列
    return next
  })

  return (
    <div>
      {series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-3 text-xs">
          {series.map((s) => {
            const total = data.reduce((sum, d) => sum + val(d, s.key), 0)
            const off = hidden.has(s.key)
            return (
              <button key={s.key} type="button" aria-pressed={!off} onClick={() => toggle(s.key)}
                className={cn('inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-gray-50', off && 'opacity-40')}>
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
                <span className="text-gray-600">{s.label}</span>
                <span className="font-medium text-gray-900">{total}</span>
              </button>
            )
          })}
        </div>
      )}
      <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
        <svg width={width} height={H} role="img" aria-label={label} className="block">
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={PAD_L} x2={width} y1={y(max * f)} y2={y(max * f)} stroke="#e5e7eb" strokeDasharray={f === 0 ? undefined : '3 3'} />
              <text x={PAD_L - 6} y={y(max * f) + 4} textAnchor="end" className="fill-gray-400 text-[10px]">{Math.round(max * f)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const gx = PAD_L + i * step + (step - groupW) / 2
            return (
              <g key={d.day} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)}>
                {/* 命中区域是整列，比柱子大 */}
                <rect x={PAD_L + i * step} y={PAD_T} width={step} height={plotH} fill={hover === i ? '#f3f4f6' : 'transparent'} />
                {shown.map((s, j) => val(d, s.key) > 0 && (
                  <path key={s.key} d={barPath(gx + j * (barW + GAP), barW, y(val(d, s.key)), y(0))} fill={s.color} />
                ))}
                {i % every === 0 && <text x={gx + groupW / 2} y={H - 6} textAnchor="middle" className="fill-gray-400 text-[10px]">{d.day.slice(5)}</text>}
              </g>
            )
          })}
        </svg>
        {h && hover !== null && (
          <div className="pointer-events-none absolute top-0 min-w-[120px] rounded-md border bg-white px-2.5 py-1.5 text-xs shadow-md"
            style={{ left: Math.min(width - 130, Math.max(0, PAD_L + hover * step + step / 2 - 60)) }}>
            <p className="mb-1 text-gray-500">{h.day}</p>
            {shown.map((s) => (
              <p key={s.key} className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-3" style={{ background: s.color }} />
                <span className="font-semibold text-gray-900">{val(h, s.key)}</span>
                <span className="text-gray-500">{s.label}</span>
              </p>
            ))}
          </div>
        )}
        <table className="sr-only">
          <caption>{label}</caption>
          <thead><tr><th>{t('dashboard.day')}</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead>
          <tbody>{data.map((d) => <tr key={d.day}><th>{d.day}</th>{series.map((s) => <td key={s.key}>{val(d, s.key)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  )
}
