// 操作记录（仅管理员）：所有入口（界面、对外接口、AI 助手、MCP、网站表单、工作流、系统）的操作，含跟进记录与字段改前改后
import { Fragment, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { crmApi } from '@/shared/utils/request'
import { formatDate } from '@/shared/utils/format'
import { Pagination } from '@/shared/components/Pagination'
import { DateRangePicker, useDateRangeParam } from '@/shared/components/DateRangePicker'
import type { User } from '@/shared/types'

interface FieldChange { field: string; from: unknown; to: unknown }

interface Operation {
  id: string
  createdAt: string
  userName: string | null
  via: string
  action: string
  category: string
  verb: string
  targetType: string | null
  targetId: string | null
  targetLabel: string | null
  summary: string | null
  changes: FieldChange[] | null
  inputSummary: string | null
  status: 'ok' | 'error'
  errorMessage: string | null
  ip: string | null
  apiKeyName: string | null
  apiKeyPrefix: string | null
}

const PAGE_SIZE = 50
const CATEGORIES = ['lead', 'client', 'activity', 'file', 'login', 'account', 'user', 'team', 'settings', 'options', 'service',
  'workflow', 'assignment', 'aiConfig', 'apiKey', 'site', 'recycleBin', 'apiFailure', 'milestone', 'call'] as const
const VIAS = ['web', 'api', 'assistant', 'mcp', 'site', 'workflow', 'system', 'history'] as const

function Select({ value, onChange, label, children }: { value: string; onChange: (v: string) => void; label: string; children: React.ReactNode }) {
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

export default function OperationLogPage() {
  const { t } = useTranslation()
  const [range, setRange] = useDateRangeParam('30d')
  const [category, setCategory] = useState('')
  const [userId, setUserId] = useState('')
  const [via, setVia] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => { setQ(search.trim()); setPage(1) }, 300)
    return () => clearTimeout(timer)
  }, [search])

  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => crmApi.get<{ data: User[] }>('/users').then((r) => r.data),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['operation-log', range.from, range.to, category, userId, via, status, q, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (range.from) params.set('from', range.from)
      if (range.to) params.set('to', range.to)
      for (const [k, v] of Object.entries({ category, userId, via, status, q })) if (v) params.set(k, v)
      return crmApi.get<{ data: Operation[]; total: number }>(`/admin/audit-log?${params}`).then((r) => r.data)
    },
  })

  const reset = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1) }
  const opLabel = (o: Operation) => o.category === 'call'
    ? `${t('opLog.category.call')} · ${o.action}`
    : `${t(`opLog.category.${o.category}`, { defaultValue: o.category })} · ${t(`opLog.verb.${o.verb}`, { defaultValue: o.verb })}`
  const viaLabel = (o: Operation) => t(`opLog.via.${o.via}`, { defaultValue: o.via })
  const fmt = (v: unknown) => {
    if (v === null || v === undefined || v === '') return t('opLog.empty')
    if (Array.isArray(v)) return v.length ? v.join('、') : t('opLog.empty')
    return typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
  const target = (o: Operation) => {
    const label = o.targetLabel ?? (o.targetId ? t(`opLog.target.${o.targetType ?? 'other'}`, { defaultValue: o.targetId }) : '—')
    return o.targetId && (o.targetType === 'lead' || o.targetType === 'client')
      ? <Link to={`/app/${o.targetType === 'client' ? 'clients' : 'leads'}/${o.targetId}`} onClick={(e) => e.stopPropagation()}
          className="text-primary-600 hover:underline">{label}</Link>
      : <span className="text-gray-700">{label}</span>
  }
  const result = (o: Operation) => o.status === 'ok'
    ? <span className="text-xs text-green-600">{t('opLog.status.ok')}</span>
    : <span className="text-xs text-red-600">{o.errorMessage ?? t('opLog.status.error')}</span>

  const detail = (o: Operation) => (
    <div className="space-y-2 text-xs">
      {o.summary && <p className="whitespace-pre-wrap break-all text-gray-700">{o.summary}</p>}
      {o.changes && o.changes.length > 0 && (
        <table className="w-full max-w-3xl table-fixed border bg-white">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="w-28 px-2 py-1 text-left font-medium">{t('opLog.cols.field')}</th>
              <th className="px-2 py-1 text-left font-medium">{t('opLog.cols.before')}</th>
              <th className="px-2 py-1 text-left font-medium">{t('opLog.cols.after')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {o.changes.map((c) => (
              <tr key={c.field} className="align-top">
                <td className="px-2 py-1 text-gray-500">{t(`opLog.fields.${c.field}`, { defaultValue: c.field })}</td>
                <td className="whitespace-pre-wrap break-all px-2 py-1 text-gray-500 line-through decoration-gray-300">{fmt(c.from)}</td>
                <td className="whitespace-pre-wrap break-all px-2 py-1 text-gray-900">{fmt(c.to)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {o.inputSummary && (
        <div>
          <p className="text-gray-500">{t('opLog.input')}</p>
          <pre className="whitespace-pre-wrap break-all text-gray-700">{o.inputSummary}</pre>
        </div>
      )}
      <p className="text-gray-400">
        {o.ip && <span className="mr-3">IP {o.ip}</span>}
        {o.apiKeyPrefix && <span className="mr-3">API Key {o.apiKeyName ?? o.apiKeyPrefix}</span>}
        <span className="font-mono">{o.action}</span>
      </p>
      {!o.summary && !o.changes?.length && !o.inputSummary && <p className="text-gray-400">{t('opLog.noDetail')}</p>}
    </div>
  )

  const rows = data?.data ?? []

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-gray-900 sm:text-xl">{t('opLog.title')}</h1>
        <p className="mt-0.5 text-sm text-gray-500">{data ? t('opLog.summary', { total: data.total }) : ' '}</p>
      </div>

      <div className="overflow-hidden rounded-lg border bg-white">
        {/* 筛选：时间段、分类、操作人、入口、结果、关键词 */}
        <div className="space-y-2 border-b px-3 py-3 sm:flex sm:flex-wrap sm:items-center sm:gap-2 sm:space-y-0 sm:px-4">
          <DateRangePicker value={range} onChange={(v) => { setRange(v); setPage(1) }} allowAll />
          <div className="grid grid-cols-2 gap-2 sm:contents">
            <Select value={category} onChange={reset(setCategory)} label={t('opLog.allCategories')}>
              <option value="">{t('opLog.allCategories')}</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{t(`opLog.category.${c}`)}</option>)}
            </Select>
            <Select value={userId} onChange={reset(setUserId)} label={t('opLog.allUsers')}>
              <option value="">{t('opLog.allUsers')}</option>
              {(usersData?.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
            <Select value={via} onChange={reset(setVia)} label={t('opLog.allVia')}>
              <option value="">{t('opLog.allVia')}</option>
              {VIAS.map((v) => <option key={v} value={v}>{t(`opLog.via.${v}`)}</option>)}
            </Select>
            <Select value={status} onChange={reset(setStatus)} label={t('opLog.allStatus')}>
              <option value="">{t('opLog.allStatus')}</option>
              <option value="ok">{t('opLog.status.ok')}</option>
              <option value="error">{t('opLog.status.error')}</option>
            </Select>
          </div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('opLog.searchPlaceholder')}
            className="h-9 w-full rounded-md border border-gray-300 px-2.5 text-sm shadow-sm sm:w-56" />
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-sm text-gray-400">{t('common.loading')}</div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">{t('opLog.none')}</div>
        ) : (
          <>
            {/* 桌面端表格 */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="border-b bg-gray-50">
                  <tr>
                    {(['time', 'user', 'via', 'action', 'target', 'content', 'result'] as const).map((c) => (
                      <th key={c} className="whitespace-nowrap px-4 py-2 text-left font-medium text-gray-700">{t(`opLog.cols.${c}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((o) => (
                    <Fragment key={o.id}>
                      <tr className="cursor-pointer hover:bg-gray-50" onClick={() => setExpanded(expanded === o.id ? null : o.id)}>
                        <td className="whitespace-nowrap px-4 py-2 text-gray-500">{formatDate(o.createdAt)}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-gray-800">{o.userName ?? t('opLog.systemUser')}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-gray-600">{viaLabel(o)}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-gray-800">{opLabel(o)}</td>
                        <td className="max-w-[12rem] truncate px-4 py-2">{target(o)}</td>
                        <td className="max-w-[24rem] truncate px-4 py-2 text-gray-500">
                          {o.summary ?? (o.changes?.length ? o.changes.map((c) => t(`opLog.fields.${c.field}`, { defaultValue: c.field })).join('、') : '')}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2">{result(o)}</td>
                      </tr>
                      {expanded === o.id && (
                        <tr><td colSpan={7} className="bg-gray-50 px-4 py-3">{detail(o)}</td></tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 手机端卡片 */}
            <div className="divide-y md:hidden">
              {rows.map((o) => (
                <div key={o.id} className="px-3 py-3" onClick={() => setExpanded(expanded === o.id ? null : o.id)}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900">{opLabel(o)}</p>
                    {result(o)}
                  </div>
                  <p className="mt-0.5 truncate text-sm">{target(o)}</p>
                  {o.summary && expanded !== o.id && <p className="mt-0.5 line-clamp-2 break-all text-xs text-gray-500">{o.summary}</p>}
                  <p className="mt-1 text-xs text-gray-400">{formatDate(o.createdAt)} · {o.userName ?? t('opLog.systemUser')} · {viaLabel(o)}</p>
                  {expanded === o.id && <div className="mt-2 rounded bg-gray-50 p-2">{detail(o)}</div>}
                </div>
              ))}
            </div>
          </>
        )}
        {data && data.total > PAGE_SIZE && (
          <div className="px-4 pb-3">
            <Pagination page={page} totalPages={Math.ceil(data.total / PAGE_SIZE)} total={data.total} pageSize={PAGE_SIZE} onPageChange={setPage} />
          </div>
        )}
      </div>
    </div>
  )
}
