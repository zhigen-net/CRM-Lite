// 列表页统一布局：标题区 → 列表卡片（顶部筛选栏 + 桌面端表格 / 手机端列表 + 分页）
// 所有列表页都用这里的组件和表格样式，不要在页面里另写一套，避免各页面样式走样
import type { ReactNode } from 'react'

/** 表格样式：行高统一 py-2.5；单元格默认不换行，长文字用 <Clip> 截断，次要信息可用 <Sub> 放第二行 */
export const tableCls = {
  table: 'w-full text-sm',
  thead: 'border-b bg-gray-50',
  th: 'whitespace-nowrap px-4 py-2.5 text-left font-medium text-gray-700',
  tbody: 'divide-y divide-gray-100',
  tr: 'hover:bg-gray-50',
  td: 'whitespace-nowrap px-4 py-2.5',
} as const

/** 页面标题区：标题、统计总结、右侧操作按钮；与内容间距统一 16px */
export function PageHeader({ title, summary, actions }: { title: ReactNode; summary?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-gray-900 sm:text-xl">{title}</h1>
        <p className="mt-0.5 text-sm text-gray-500">{summary ?? ' '}</p>
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  )
}

/** 列表卡片：toolbar 放筛选（不裁切，下拉面板可以盖住表格），footer 放分页 */
export function ListCard({ toolbar, footer, children }: { toolbar?: ReactNode; footer?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-lg border bg-white">
      {toolbar && <div className="relative border-b px-3 py-3 sm:px-4">{toolbar}</div>}
      {children}
      {footer && <div className="px-3 pb-3 sm:px-4">{footer}</div>}
    </div>
  )
}

/** 筛选栏一行：手机上竖排，桌面端横排自动换行 */
export function ToolbarRow({ children }: { children: ReactNode }) {
  return <div className="space-y-2 sm:flex sm:flex-wrap sm:items-center sm:gap-2 sm:space-y-0">{children}</div>
}

/** 加载中、空列表等提示 */
export function ListMessage({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-gray-400">{children}</div>
}

const SHOW = { sm: 'hidden sm:block', md: 'hidden md:block' } as const
const HIDE = { sm: 'sm:hidden', md: 'md:hidden' } as const

/** 桌面端表格：宽度不够时横向滚动，不挤压换行；overlay 放在滚动区域外（如列设置弹窗），避免被裁切 */
export function DesktopTable({ children, from = 'sm', overlay }: { children: ReactNode; from?: keyof typeof SHOW; overlay?: ReactNode }) {
  return (
    <div className={`relative ${SHOW[from]}`}>
      {overlay}
      <div className="overflow-x-auto rounded-b-lg">
        <table className={tableCls.table}>{children}</table>
      </div>
    </div>
  )
}

/** 手机端列表：卡片内分隔线排列 */
export function MobileList({ children, from = 'sm' }: { children: ReactNode; from?: keyof typeof HIDE }) {
  return <ul className={`divide-y divide-gray-100 ${HIDE[from]}`}>{children}</ul>
}

/** 单行截断，悬停显示全文 */
export function Clip({ text, className = 'max-w-[14rem]', children }: { text: string | null | undefined; className?: string; children?: ReactNode }) {
  return <div className={`truncate ${className}`} title={text ?? undefined}>{children ?? text}</div>
}

/** 单元格第二行的次要信息（小号灰字，同样单行截断） */
export function Sub({ children, title }: { children: ReactNode; title?: string | undefined }) {
  return <div className="max-w-[16rem] truncate text-xs text-gray-400" title={title}>{children}</div>
}

/** 筛选栏下拉框（高度 h-9，与时间段选择、搜索框对齐） */
export function FilterSelect({ value, onChange, label, children }: { value: string; onChange: (v: string) => void; label: string; children: ReactNode }) {
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

/** 筛选栏搜索框；filter 传入时右侧显示「筛选」按钮（展开更多条件的面板由页面自己渲染） */
export function SearchBox({ value, onChange, placeholder, filter }: {
  value: string; onChange: (v: string) => void; placeholder: string
  filter?: { label: string; active: boolean; open: boolean; onToggle: () => void } | undefined
}) {
  return (
    <div className="flex h-9 min-w-0 flex-1 items-center rounded-md border border-gray-300 bg-white shadow-sm transition-colors focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500 sm:max-w-md">
      <input className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-sm outline-none placeholder:text-gray-400"
        placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      {filter && (
        <button type="button" onClick={filter.onToggle}
          className="relative flex h-full items-center gap-1 border-l border-gray-200 px-3 text-gray-500 transition-colors hover:text-gray-700">
          {filter.active && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary-500" />}
          <span className="text-xs">{filter.label}</span>
          <svg className={`h-3.5 w-3.5 transition-transform ${filter.open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}
    </div>
  )
}
