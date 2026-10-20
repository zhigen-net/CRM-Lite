// 访客异常小图标：机器人、机房 / 云服务器、VPN / 代理。悬停显示原因，手机上点按显示
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface Anomaly { type: 'bot' | 'datacenter' | 'vpn'; signal: string; detail?: string }

const ICONS: Record<Anomaly['type'], { path: string; color: string }> = {
  // 机器人：方头 + 天线
  bot: { path: 'M12 2v3 M8 5h8a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3Z M9.5 11h.01 M14.5 11h.01 M9.5 15h5 M2 11v3 M22 11v3', color: 'text-amber-600' },
  // 机房：两层服务器
  datacenter: { path: 'M4 4h16v6H4Z M4 14h16v6H4Z M8 7h.01 M8 17h.01', color: 'text-slate-500' },
  // VPN：盾牌 + 锁孔
  vpn: { path: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z M12 10v3', color: 'text-indigo-600' },
}

export function AnomalyIcons({ items }: { items?: Anomaly[] | null | undefined }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<number | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (open === null) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  if (!items?.length) return null
  const text = (a: Anomaly) => `${t(`analytics.anomaly.${a.type}`)}：${t(`analytics.anomaly.signals.${a.signal}`, { detail: a.detail ?? '' })}`

  return (
    <span ref={ref} className="relative inline-flex items-center gap-0.5 align-middle">
      {items.map((a, i) => (
        <button key={a.type} type="button" title={text(a)} aria-label={text(a)}
          onClick={(e) => { e.stopPropagation(); setOpen(open === i ? null : i) }}
          className={`rounded p-0.5 hover:bg-gray-100 ${ICONS[a.type].color}`}>
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {ICONS[a.type].path.split(/ (?=M)/).map((d, j) => <path key={j} d={d} />)}
          </svg>
        </button>
      ))}
      {open !== null && items[open] && (
        <span className="absolute left-0 top-full z-30 mt-1 w-56 rounded-md border bg-white px-2.5 py-1.5 text-xs font-normal text-gray-600 shadow-md">
          {text(items[open])}
        </span>
      )}
    </span>
  )
}
