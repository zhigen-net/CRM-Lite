import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { crmApi } from '@/shared/utils/request'
import { Badge } from '@/shared/components/Badge'
import { formatDate } from '@/shared/utils/format'
import type { Client, User } from '@/shared/types'
import { useOptionGroup, getOptionColor } from '@/shared/hooks/useOptions'
import { ActivityModal } from '@/shared/components/ActivityModal'
import type { ActivitySubmitData } from '@/shared/components/ActivityModal'
import { Pagination } from '@/shared/components/Pagination'
import { useCrmAuth } from '@/app/auth/CrmAuthContext'

const PAGE_SIZE = 20

export default function ClientsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { user } = useCrmAuth()
  const isAdmin = user?.role === 'admin'
  const canFilterUser = user?.role === 'admin' || user?.role === 'operations'

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [followUpTarget, setFollowUpTarget] = useState<Client | null>(null)
  const [searchParams] = useSearchParams()
  const [showFilterPanel, setShowFilterPanel] = useState(() => !!searchParams.get('nextContact'))
  const [contractStatusFilter, setContractStatusFilter] = useState('')
  const [assignedUserFilter, setAssignedUserFilter] = useState('')
  const [createdAtFilter, setCreatedAtFilter] = useState('')
  // 仪表盘「待跟进」跳转时带 ?nextContact=overdue / today
  const [nextContactFilter, setNextContactFilter] = useState(() => searchParams.get('nextContact') ?? '')
  const filterPanelRef = useRef<HTMLDivElement>(null)

  const { options: contractStatusOpts } = useOptionGroup('contract_status')

  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterPanelRef.current && !filterPanelRef.current.contains(e.target as Node)) {
        setShowFilterPanel(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => crmApi.get<{ data: User[] }>('/users').then((r) => r.data),
    enabled: canFilterUser,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['clients', debouncedSearch, contractStatusFilter, assignedUserFilter, createdAtFilter, nextContactFilter, page],
    queryFn: () => crmApi.get<{ data: Client[]; total: number; page: number; pageSize: number }>('/clients', {
      params: {
        search: debouncedSearch || undefined,
        contractStatus: contractStatusFilter || undefined,
        assignedSalesUserId: assignedUserFilter || undefined,
        createdAt: createdAtFilter || undefined,
        nextContact: nextContactFilter || undefined,
        page,
        pageSize: PAGE_SIZE,
      },
    }).then((r) => r.data),
  })

  const filtered = data?.data ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const hasFilter = !!(contractStatusFilter || assignedUserFilter || createdAtFilter || nextContactFilter)
  const resetFilters = () => {
    setContractStatusFilter(''); setAssignedUserFilter(''); setCreatedAtFilter(''); setNextContactFilter(''); setPage(1)
  }

  const addActivity = useMutation({
    mutationFn: (body: ActivitySubmitData) =>
      crmApi.post('/activities', { ...body, clientId: followUpTarget!.id }),
    onSuccess: () => setFollowUpTarget(null),
  })

  const deleteClient = useMutation({
    mutationFn: (id: string) => crmApi.delete(`/clients/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clients'] }),
  })

  const openFollowUp = (client: Client, e: React.MouseEvent) => {
    e.preventDefault()
    setFollowUpTarget(client)
  }

  const selectClass = 'rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary-500'

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-gray-900">{t('clients.title')}</h1>
          <p className="mt-0.5 text-xs sm:text-sm text-gray-500">{t('common.total')} {total} {t('clients.count')}</p>
        </div>
      </div>

      {/* 搜索框 + 筛选 */}
      <div className="mb-4 relative" ref={filterPanelRef}>
        <div className="flex items-center rounded-md border border-gray-300 bg-white shadow-sm transition-colors focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500">
          <input
            className="flex-1 px-3 py-2 text-sm bg-transparent outline-none placeholder:text-gray-400"
            placeholder={t('clients.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            onClick={() => setShowFilterPanel((v) => !v)}
            className="relative flex items-center gap-1 px-3 py-2 border-l border-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
          >
            {hasFilter && (
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-primary-500" />
            )}
            <span className="text-xs">{t('activities.filterLabel')}</span>
            <svg
              className={`w-3.5 h-3.5 transition-transform ${showFilterPanel ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {showFilterPanel && (
          <div className="absolute z-20 top-full left-0 right-0 mt-1 rounded-md border border-gray-200 bg-white shadow-lg p-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {contractStatusOpts.length > 0 && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-500">{t('clients.cols.contractStatus')}</label>
                  <select value={contractStatusFilter} onChange={(e) => { setContractStatusFilter(e.target.value); setPage(1) }} className={selectClass}>
                    <option value="">{t('clients.filter.allStatus')}</option>
                    {contractStatusOpts.filter((o) => o.isActive).map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              )}
              {canFilterUser && usersData?.data && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-500">{t('clients.cols.owner')}</label>
                  <select value={assignedUserFilter} onChange={(e) => { setAssignedUserFilter(e.target.value); setPage(1) }} className={selectClass}>
                    <option value="">{t('common.all')}</option>
                    {usersData.data.filter((u) => u.isActive).map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">{t('clients.cols.createdAt')}</label>
                <select value={createdAtFilter} onChange={(e) => { setCreatedAtFilter(e.target.value); setPage(1) }} className={selectClass}>
                  <option value="">{t('leads.filter.allTime')}</option>
                  <option value="today">{t('leads.filter.today')}</option>
                  <option value="week">{t('leads.filter.last7Days')}</option>
                  <option value="month">{t('leads.filter.last30Days')}</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">{t('clients.cols.nextContact')}</label>
                <select value={nextContactFilter} onChange={(e) => { setNextContactFilter(e.target.value); setPage(1) }} className={selectClass}>
                  <option value="">{t('common.all')}</option>
                  <option value="overdue">{t('leads.filter.overdue')}</option>
                  <option value="today">{t('leads.filter.dueToday')}</option>
                  <option value="week">{t('leads.filter.next7Days')}</option>
                </select>
              </div>
            </div>
            {hasFilter && (
              <div className="mt-2 pt-2 border-t border-gray-100 flex justify-end">
                <button onClick={resetFilters} className="text-xs text-gray-400 hover:text-gray-600">{t('activities.resetFilter')}</button>
              </div>
            )}
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-gray-500">{t('common.loading')}</div>
      ) : !filtered?.length ? (
        <div className="py-12 text-center text-sm text-gray-500">
          {debouncedSearch || hasFilter ? t('clients.noMatch') : t('clients.empty')}
        </div>
      ) : (
        <>
          {/* 桌面端表格 */}
          <div className="hidden sm:block rounded-lg border bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">{t('clients.cols.id')}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">{t('common.name')}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">{t('clients.cols.contact')}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">{t('clients.cols.plan')}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">{t('clients.cols.contractStatus')}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">{t('clients.cols.nextContact')}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">{t('clients.cols.createdBy')}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">{t('clients.cols.createdAt')}</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((client) => (
                  <tr key={client.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-400 text-xs font-mono">{client.leadNo != null ? `L-${String(client.leadNo).padStart(4, '0')}` : '—'}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{client.name}</td>
                    <td className="px-4 py-3 text-gray-600">
                      <div>{client.phone ?? '—'}</div>
                      {client.email && <div className="text-xs text-gray-400">{client.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {(client.servicePlans ?? []).join(t('common.sep')) || '—'}
                    </td>
                    <td className="px-4 py-3">
                      {client.contractStatus ? (
                        <Badge variant={getOptionColor(contractStatusOpts, client.contractStatus)}>
                          {client.contractStatus}
                        </Badge>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {client.nextContactDate
                        ? <span className={new Date(client.nextContactDate) < new Date() ? 'text-red-500 font-medium' : 'text-gray-500'}>{formatDate(client.nextContactDate)}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{client.createdByName ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(client.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => openFollowUp(client, e)}
                          className="text-xs text-primary-600 hover:text-primary-800 font-medium"
                        >
                          {t('clients.addActivity')}
                        </button>
                        <span className="text-gray-300">|</span>
                        <Link to={`/app/clients/${client.id}`} className="text-xs text-gray-500 hover:text-gray-700">
                          {t('common.detail')}
                        </Link>
                        {isAdmin && (
                          <>
                            <span className="text-gray-300">|</span>
                            <button
                              onClick={() => { if (confirm(t('clients.deleteConfirm', { name: client.name }))) deleteClient.mutate(client.id) }}
                              className="text-xs text-red-500 hover:text-red-700"
                            >
                              {t('common.delete')}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 移动端卡片列表 */}
          <div className="sm:hidden space-y-3">
            {filtered.map((client) => (
              <div key={client.id} className="rounded-lg border bg-white overflow-hidden">
                <Link
                  to={`/app/clients/${client.id}`}
                  className="block p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{client.name}</p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {client.leadNo != null && (
                          <span className="font-mono text-gray-400 mr-1">L-{String(client.leadNo).padStart(4, '0')}</span>
                        )}
                        {client.phone ?? client.email ?? t('clients.noContact')}
                      </p>
                    </div>
                    {client.contractStatus ? (
                      <Badge variant={getOptionColor(contractStatusOpts, client.contractStatus)} className="flex-shrink-0">
                        {client.contractStatus}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
                    <span>{(client.servicePlans ?? []).join('、') || t('clients.detail.noPlan')}</span>
                    <span className="ml-auto">{formatDate(client.createdAt)}</span>
                  </div>
                  {client.nextContactDate && (
                    <div className="mt-1 text-xs text-gray-400">
                      {t('clients.detail.nextContact')}<span className={new Date(client.nextContactDate) < new Date() ? 'text-red-500 font-medium' : 'text-gray-500'}>{formatDate(client.nextContactDate)}</span>
                    </div>
                  )}
                </Link>
                <div className="border-t px-4 py-2 flex justify-end">
                  <button
                    onClick={(e) => openFollowUp(client, e)}
                    className="text-sm text-primary-600 font-medium"
                  >
                    {t('activityModal.title')}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <Pagination page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </>
      )}

      {followUpTarget && (
        <ActivityModal
          title={`${t('activityModal.followUp')}${followUpTarget.name}`}
          onClose={() => setFollowUpTarget(null)}
          loading={addActivity.isPending}
          onSubmit={(d) => addActivity.mutate(d)}
          showNextContact
          entityType="client"
        />
      )}
    </div>
  )
}
