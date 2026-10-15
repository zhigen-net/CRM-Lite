import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { crmApi } from '@/shared/utils/request'
import { formatDate } from '@/shared/utils/format'
import { Pagination } from '@/shared/components/Pagination'

interface AuditEntry {
  id: string
  createdAt: string
  userName: string | null
  via: string
  action: string
  targetType: 'lead' | 'client' | null
  targetId: string | null
  inputSummary: string | null
  status: 'ok' | 'error'
  errorMessage: string | null
  apiKeyName: string | null
  apiKeyPrefix: string | null
}

const PAGE_SIZE = 50
const VIA_VALUES = ['api', 'assistant', 'mcp'] as const

/** 审计日志：对外接口、AI 助手、MCP 的调用记录（仅管理员可见） */
export function AuditLogPanel() {
  const { t } = useTranslation()
  const [via, setVia] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-audit-log', via, status, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (via) params.set('via', via)
      if (status) params.set('status', status)
      return crmApi.get<{ data: AuditEntry[]; total: number }>(`/admin/audit-log?${params}`).then((r) => r.data)
    },
  })

  const selectCls = 'rounded border border-gray-300 px-2 py-1 text-xs text-gray-700'

  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b bg-gray-50">
        <div>
          <h2 className="font-semibold text-gray-800 text-sm">{t('settings.auditLog.title')}</h2>
          <p className="text-xs text-gray-400 mt-0.5">{t('settings.auditLog.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <select className={selectCls} value={via} onChange={(e) => { setVia(e.target.value); setPage(1) }}>
            <option value="">{t('settings.auditLog.allVia')}</option>
            {VIA_VALUES.map((v) => <option key={v} value={v}>{t(`settings.auditLog.via.${v}`)}</option>)}
          </select>
          <select className={selectCls} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}>
            <option value="">{t('settings.auditLog.allStatus')}</option>
            <option value="ok">{t('settings.auditLog.status.ok')}</option>
            <option value="error">{t('settings.auditLog.status.error')}</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="py-10 text-center text-sm text-gray-400">{t('common.loading')}</div>
      ) : !data?.data.length ? (
        <div className="py-10 text-center text-sm text-gray-400">{t('settings.auditLog.empty')}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {(['time', 'user', 'via', 'action', 'target', 'result'] as const).map((c) => (
                  <th key={c} className="px-4 py-2 text-left font-medium text-gray-700 whitespace-nowrap">{t(`settings.auditLog.cols.${c}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.data.map((r) => (
                <Fragment key={r.id}>
                  <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                    <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                    <td className="px-4 py-2 text-gray-800 whitespace-nowrap">{r.userName ?? '—'}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className="text-gray-700">{t(`settings.auditLog.via.${r.via}`, { defaultValue: r.via })}</span>
                      {r.apiKeyPrefix && <span className="ml-1 font-mono text-xs text-gray-400">{r.apiKeyName ?? r.apiKeyPrefix}</span>}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-700">{r.action}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {r.targetId && r.targetType ? (
                        <Link
                          to={`/app/${r.targetType === 'client' ? 'clients' : 'leads'}/${r.targetId}`}
                          className="text-xs text-primary-600 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {t(`settings.auditLog.target.${r.targetType}`)}
                        </Link>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2">
                      {r.status === 'ok'
                        ? <span className="text-xs text-green-600">{t('settings.auditLog.status.ok')}</span>
                        : <span className="text-xs text-red-600">{r.errorMessage ?? t('settings.auditLog.status.error')}</span>}
                    </td>
                  </tr>
                  {expanded === r.id && (
                    <tr>
                      <td colSpan={6} className="bg-gray-50 px-4 py-2">
                        <p className="text-xs text-gray-500 mb-1">{t('settings.auditLog.input')}</p>
                        <pre className="whitespace-pre-wrap break-all text-xs text-gray-700">{r.inputSummary ?? '—'}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <div className="px-4 pb-3">
          <Pagination page={page} totalPages={Math.ceil(data.total / PAGE_SIZE)} total={data.total} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </div>
      )}
    </div>
  )
}
