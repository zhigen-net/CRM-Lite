import { useState, useEffect, useRef } from 'react'
import { Clip, DesktopTable, ListCard, ListMessage, MobileList, PageHeader, SearchBox, Sub, tableCls } from '@/shared/components/ListLayout'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Drawer } from '@/shared/components/Drawer'
import { ClientDetail } from './ClientDetailPage'
import { useTranslation } from 'react-i18next'
import { crmApi } from '@/shared/utils/request'
import { Badge } from '@/shared/components/Badge'
import { formatDate } from '@/shared/utils/format'
import type { Client, User } from '@/shared/types'
import { useOptionGroup, getOptionColor, getOptionLabel } from '@/shared/hooks/useOptions'
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
  // 详情在抽屉里打开：地址 /app/clients/:id，关闭回到列表（保留查询参数）
  const { id: openId } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const detailTo = (id: string) => ({ pathname: `/app/clients/${id}`, search: location.search })
  const closeDetail = () => navigate({ pathname: '/app/clients', search: location.search })
  const { data: openClient } = useQuery({
    queryKey: ['client', openId],
    queryFn: () => crmApi.get<{ data: Client }>(`/clients/${openId}`).then((r) => r.data.data),
    enabled: !!openId,
  })
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
      <PageHeader title={t('clients.title')} summary={`${t('common.total')} ${total} ${t('clients.count')}`} />

      <ListCard
        footer={<Pagination page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />}
        toolbar={
      /* 搜索框 + 筛选 */
      <div className="relative" ref={filterPanelRef}>
        <SearchBox
          value={search} onChange={setSearch} placeholder={t('clients.search')}
          filter={{ label: t('activities.filterLabel'), active: !!hasFilter, open: showFilterPanel, onToggle: () => setShowFilterPanel((v) => !v) }}
        />

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
      }>
      {isLoading ? (
        <ListMessage>{t('common.loading')}</ListMessage>
      ) : !filtered?.length ? (
        <ListMessage>{debouncedSearch || hasFilter ? t('clients.noMatch') : t('clients.empty')}</ListMessage>
      ) : (
        <>
          {/* 桌面端表格 */}
          <DesktopTable>
              <thead className={tableCls.thead}>
                <tr>
                  <th className={tableCls.th}>{t('clients.cols.id')}</th>
                  <th className={tableCls.th}>{t('common.name')}</th>
                  <th className={tableCls.th}>{t('clients.cols.contact')}</th>
                  <th className={tableCls.th}>{t('clients.cols.plan')}</th>
                  <th className={tableCls.th}>{t('clients.cols.contractStatus')}</th>
                  <th className={tableCls.th}>{t('clients.cols.nextContact')}</th>
                  <th className={tableCls.th}>{t('clients.cols.createdBy')}</th>
                  <th className={tableCls.th}>{t('clients.cols.createdAt')}</th>
                  <th className="sticky right-0 bg-gray-50 px-4 py-2.5 shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.12)]"></th>
                </tr>
              </thead>
              <tbody className={tableCls.tbody}>
                {filtered.map((client) => (
                  <tr key={client.id} className={`group ${tableCls.tr}`}>
                    <td className={`${tableCls.td} font-mono text-xs text-gray-400`}>{client.leadNo != null ? `L-${String(client.leadNo).padStart(4, '0')}` : '—'}</td>
                    <td className={`${tableCls.td} font-medium text-gray-900`}><Clip text={client.name} className="max-w-[10rem]" /></td>
                    <td className={`${tableCls.td} text-gray-600`}>
                      <div>{client.phone ?? (client.email ? null : '—')}</div>
                      {client.email && (client.phone ? <Sub title={client.email}>{client.email}</Sub> : <Clip text={client.email} className="max-w-[12rem]" />)}
                    </td>
                    <td className={`${tableCls.td} text-gray-600`}>
                      <Clip text={(client.servicePlans ?? []).join(t('common.sep')) || '—'} className="max-w-[10rem]" />
                    </td>
                    <td className={tableCls.td}>
                      {client.contractStatus ? (
                        <Badge variant={getOptionColor(contractStatusOpts, client.contractStatus)}>
                          {getOptionLabel(contractStatusOpts, client.contractStatus)}
                        </Badge>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className={`${tableCls.td} text-xs`}>
                      {client.nextContactDate
                        ? <span className={new Date(client.nextContactDate) < new Date() ? 'text-red-500 font-medium' : 'text-gray-500'}>{formatDate(client.nextContactDate)}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className={`${tableCls.td} text-gray-600`}>{client.createdByName ?? '—'}</td>
                    <td className={`${tableCls.td} text-gray-500`}>{formatDate(client.createdAt)}</td>
                    {/* 操作列固定在右侧，表格横向滚动时也能看到 */}
                    <td className="sticky right-0 whitespace-nowrap bg-white px-4 py-2.5 shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.12)] group-hover:bg-gray-50">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={(e) => openFollowUp(client, e)}
                          className="text-xs text-primary-600 hover:text-primary-800 font-medium"
                        >
                          {t('clients.addActivity')}
                        </button>
                        <span className="text-gray-300">|</span>
                        <Link to={detailTo(client.id)} className="text-xs text-gray-500 hover:text-gray-700">
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
          </DesktopTable>

          {/* 移动端卡片列表：紧凑排布，电话可直接拨打，跟进按钮在卡片右下角 */}
          <MobileList>
            {filtered.map((client) => {
              const overdue = !!client.nextContactDate && new Date(client.nextContactDate) < new Date()
              const contact = client.phone ?? client.email
              return (
                <li key={client.id}>
                  <Link to={detailTo(client.id)} className="block px-3 pt-3 active:bg-gray-50">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate font-medium text-gray-900">{client.name}</p>
                      {client.contractStatus && (
                        <Badge variant={getOptionColor(contractStatusOpts, client.contractStatus)} className="flex-shrink-0">
                          {getOptionLabel(contractStatusOpts, client.contractStatus)}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-gray-500">
                      {client.leadNo != null && <span className="mr-1 font-mono text-gray-400">L-{String(client.leadNo).padStart(4, '0')}</span>}
                      {(client.servicePlans ?? []).join('、') || t('clients.detail.noPlan')}
                    </p>
                  </Link>
                  <div className="flex items-center gap-2 px-3 pb-2.5 pt-1.5 text-xs">
                    {contact
                      ? <a href={client.phone ? `tel:${client.phone}` : `mailto:${client.email}`} className="min-w-0 truncate text-primary-600">{contact}</a>
                      : <span className="text-gray-400">{t('clients.noContact')}</span>}
                    {client.nextContactDate && (
                      <span className={overdue ? 'shrink-0 font-medium text-red-500' : 'shrink-0 text-gray-400'}>
                        {t('clients.detail.nextContact')}{formatDate(client.nextContactDate).slice(5)}
                      </span>
                    )}
                    <button onClick={(e) => openFollowUp(client, e)}
                      className="ml-auto shrink-0 rounded-md border border-primary-200 px-2 py-1 font-medium text-primary-600 active:bg-primary-50">
                      {t('clients.addActivity')}
                    </button>
                  </div>
                </li>
              )
            })}
          </MobileList>
        </>
      )}
      </ListCard>

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
      {openId && (
        <Drawer title={openClient?.name ?? t('common.loading')} onClose={closeDetail}>
          <ClientDetail id={openId} />
        </Drawer>
      )}
    </div>
  )
}
