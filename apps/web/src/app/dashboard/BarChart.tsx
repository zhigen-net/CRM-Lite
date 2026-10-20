// 单系列柱状图（按天）：内联 SVG，悬停显示日期与数值；附隐藏表格供读屏
import { useEffect, useRef, useState } from 'react'

const H = 180, PAD_L = 32, PAD_B = 22, PAD_T = 8

/** 纵轴刻度：取整到 1 / 2 / 5 × 10^n */
function niceMax(v: number) {
  if (v <= 4) return Math.max(4, v)
  const p = 10 ** Math.floor(Math.log10(v))
  return [1, 2, 5, 10].map((m) => m * p).find((m) => m >= v) ?? v
}

export function BarChart({ data, label }: { data: { day: string; value: number }[]; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e!.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])

  const max = niceMax(Math.max(0, ...data.map((d) => d.value)))
  const plotW = width - PAD_L, plotH = H - PAD_B - PAD_T
  const step = plotW / Math.max(1, data.length)
  const barW = Math.max(1, Math.min(32, step - 2))
  const y = (v: number) => PAD_T + plotH - (v / max) * plotH
  // 横轴最多显示约 8 个日期
  const every = Math.max(1, Math.ceil(data.length / 8))
  const h = hover !== null ? data[hover] : null

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      <svg width={width} height={H} role="img" aria-label={label} className="block">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD_L} x2={width} y1={y(max * f)} y2={y(max * f)} stroke="#e5e7eb" strokeDasharray={f === 0 ? undefined : '3 3'} />
            <text x={PAD_L - 6} y={y(max * f) + 4} textAnchor="end" className="fill-gray-400 text-[10px]">{Math.round(max * f)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = PAD_L + i * step + (step - barW) / 2
          const top = y(d.value), bottom = y(0)
          const r = Math.min(4, barW / 2, bottom - top)
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)}>
              {/* 命中区域比柱子大，整列都可以悬停 */}
              <rect x={PAD_L + i * step} y={PAD_T} width={step} height={plotH} fill="transparent" />
              {d.value > 0 && (
                <path d={`M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${bottom} Z`}
                  className={hover === i ? 'fill-primary-700' : 'fill-primary-500'} />
              )}
              {i % every === 0 && <text x={x + barW / 2} y={H - 6} textAnchor="middle" className="fill-gray-400 text-[10px]">{d.day.slice(5)}</text>}
            </g>
          )
        })}
      </svg>
      {h && hover !== null && (
        <div className="pointer-events-none absolute top-0 rounded-md border bg-white px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: Math.min(width - 110, Math.max(0, PAD_L + hover * step + step / 2 - 55)) }}>
          <p className="text-base font-semibold text-gray-900">{h.value}</p>
          <p className="text-gray-500">{h.day}</p>
        </div>
      )}
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>{data.map((d) => <tr key={d.day}><th>{d.day}</th><td>{d.value}</td></tr>)}</tbody>
      </table>
    </div>
  )
}
