import { useState, useEffect, useRef } from 'react'
import { Tip, Clip, DesktopTable, ListCard, ListMessage, MobileList, PageHeader, SearchBox, tableCls } from '@/shared/components/ListLayout'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Drawer } from '@/shared/components/Drawer'
import { LeadDetail } from './LeadDetailPage'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { crmApi } from '@/shared/utils/request'
import { Button } from '@/shared/components/Button'
import { Input } from '@/shared/components/Input'
import { Badge } from '@/shared/components/Badge'
import { Modal } from '@/shared/components/Modal'
import { Textarea } from '@/shared/components/Textarea'
import { Combobox } from '@/shared/components/Combobox'
import { ContactMatches } from './ContactMatches'
import { Pagination } from '@/shared/components/Pagination'
import { ActivityModal } from '@/shared/components/ActivityModal'
import type { ActivitySubmitData } from '@/shared/components/ActivityModal'
import { formatDate } from '@/shared/utils/format'
import { useOptionGroup, getOptionColor, getOptionLabel } from '@/shared/hooks/useOptions'
import { useCrmAuth } from '@/app/auth/CrmAuthContext'
import type { Lead, Service, User } from '@/shared/types'

const COL_KEYS = ['leadNo','name','contactInfo','intendedServices','status','source','assignedToName','nextContactDate','activityCount','createdAt'] as const
type ColKey = typeof COL_KEYS[number]
type ColConfig = { key: ColKey; visible: boolean }

const REQUIRED_COLS = new Set<ColKey>(['name'])
const DEFAULT_COLS: ColConfig[] = COL_KEYS.map((key) => ({ key, visible: true }))
const STORAGE_PREFIX = 'crm_leads_cols_'

function loadColConfig(userId: string): ColConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + userId)
    if (!raw) return DEFAULT_COLS
    const saved = JSON.parse(raw) as ColConfig[]
    const savedKeys = new Set(saved.map((c) => c.key))
    return [
      ...saved.filter((c) => COL_KEYS.includes(c.key as ColKey)),
      ...COL_KEYS.filter((k) => !savedKeys.has(k)).map((key) => ({ key, visible: true })),
    ]
  } catch {
    return DEFAULT_COLS
  }
}

function saveColConfig(userId: string, config: ColConfig[]) {
  localStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(config))
}

function ColSettingsPanel({
  config, colLabels, onChange, onClose,
}: {
  config: ColConfig[]
  colLabels: Record<ColKey, string>
  onChange: (c: ColConfig[]) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const toggle = (key: ColKey) => {
    if (REQUIRED_COLS.has(key)) return
    onChange(config.map((c) => (c.key === key ? { ...c, visible: !c.visible } : c)))
  }

  const move = (key: ColKey, dir: -1 | 1) => {
    const idx = config.findIndex((c) => c.key === key)
    const next = idx + dir
    if (next < 0 || next >= config.length) return
    const arr = [...config]
    ;[arr[idx], arr[next]] = [arr[next]!, arr[idx]!]
    onChange(arr)
  }

  return (
    <div ref={ref} className="absolute right-0 top-full mt-1 z-50 w-48 rounded-lg border bg-white shadow-lg py-1" onClick={(e) => e.stopPropagation()}>
      <p className="px-3 py-1.5 text-xs font-semibold text-gray-400 border-b">{t('leads.columnSettings')}</p>
      <ul className="py-1">
        {config.map((c, idx) => (
          <li key={c.key} className="flex items-center gap-1 px-2 py-0.5">
            <input type="checkbox" checked={c.visible} disabled={REQUIRED_COLS.has(c.key)} onChange={() => toggle(c.key)} className="accent-primary-600 cursor-pointer disabled:opacity-40" />
            <span className={`flex-1 text-xs px-1 ${REQUIRED_COLS.has(c.key) ? 'text-gray-400' : 'text-gray-700'}`}>{colLabels[c.key]}</span>
            <button onClick={() => move(c.key, -1)} disabled={idx === 0} className="p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-20">▲</button>
            <button onClick={() => move(c.key, 1)} disabled={idx === config.length - 1} className="p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-20">▼</button>
          </li>
        ))}
      </ul>
      <div className="border-t px-3 py-1.5">
        <button onClick={() => onChange(DEFAULT_COLS)} className="text-xs text-gray-400 hover:text-gray-600">{t('leads.restoreDefault')}</button>
      </div>
    </div>
  )
}

export default function LeadsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { user } = useCrmAuth()
  const [showCreate, setShowCreate] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [assignedToFilter, setAssignedToFilter] = useState('')
  // 仪表盘「待跟进」跳转时带 ?nextContact=overdue / today
  const [searchParams] = useSearchParams()
  // 详情在抽屉里打开：地址 /app/leads/:id，关闭回到列表（保留查询参数）
  const { id: openId } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const detailTo = (id: string) => ({ pathname: `/app/leads/${id}`, search: location.search })
  const closeDetail = () => navigate({ pathname: '/app/leads', search: location.search })
  const { data: openLead } = useQuery({
    queryKey: ['lead', openId],
    queryFn: () => crmApi.get<{ data: Lead }>(`/leads/${openId}`).then((r) => r.data.data),
    enabled: !!openId,
  })
  const [nextContactFilter, setNextContactFilter] = useState(() => searchParams.get('nextContact') ?? '')
  const [createdAtFilter, setCreatedAtFilter] = useState('')
  const [activityCountFilter, setActivityCountFilter] = useState('')
  const [serviceFilter, setServiceFilter] = useState('')
  const [mineOnly, setMineOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [followUpTarget, setFollowUpTarget] = useState<Lead | null>(null)
  const [colConfig, setColConfig] = useState<ColConfig[]>(DEFAULT_COLS)
  const [showColSettings, setShowColSettings] = useState(false)
  const [showFilterPanel, setShowFilterPanel] = useState(() => !!searchParams.get('nextContact'))
  const filterPanelRef = useRef<HTMLDivElement>(null)

  const colLabels: Record<ColKey, string> = {
    leadNo:           t('leads.cols.id'),
    name:             t('leads.cols.name'),
    contactInfo:      t('leads.cols.contact'),
    intendedServices: t('leads.cols.service'),
    status:           t('leads.cols.status'),
    source:           t('leads.cols.source'),
    assignedToName:   t('leads.cols.owner'),
    nextContactDate:  t('leads.cols.nextContact'),
    activityCount:    t('leads.cols.activityCount'),
    createdAt:        t('leads.cols.createdAt'),
  }

  const createSchema = z.object({
    source: z.string().min(1, t('common.unset')),
    name: z.string().min(1, t('common.unset')),
    contactInfo: z.string().min(1, t('common.unset')),
    intendedServices: z.array(z.string()),
    notes: z.string().optional(),
  })
  type CreateForm = z.infer<typeof createSchema>

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterPanelRef.current && !filterPanelRef.current.contains(e.target as Node)) setShowFilterPanel(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const PAGE_SIZE = 20
  const canToggleMine = user?.role !== 'sales'
  const isAdmin = user?.role === 'admin'

  useEffect(() => { if (user?.id) setColConfig(loadColConfig(user.id)) }, [user?.id])

  const { data: newLeadsCount } = useQuery<number>({ queryKey: ['leads', 'new-count'], enabled: false })
  const prevNewCountRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (newLeadsCount === undefined) return
    if (prevNewCountRef.current !== undefined && newLeadsCount > prevNewCountRef.current) {
      queryClient.invalidateQueries({ queryKey: ['leads'] })
    }
    prevNewCountRef.current = newLeadsCount
  }, [newLeadsCount, queryClient])

  const updateColConfig = (next: ColConfig[]) => {
    setColConfig(next)
    if (user?.id) saveColConfig(user.id, next)
  }

  const { options: leadStatusOpts } = useOptionGroup('lead_status')
  const { options: lostReasonOpts } = useOptionGroup('lost_reason')
  // 与仪表盘共用缓存 ['lead-sources']，两处都存来源数组（同一个 queryKey 的数据格式必须一致）
  const { data: sourcesData } = useQuery({
    queryKey: ['lead-sources'],
    queryFn: () => crmApi.get<{ data: string[] }>('/leads/sources').then((r) => r.data.data),
  })
  const sourceOptions = sourcesData ?? []

  const { data: servicesData } = useQuery({
    queryKey: ['services'],
    queryFn: () => crmApi.get<{ data: Service[] }>('/services').then((r) => r.data),
  })
  const serviceOptions = servicesData?.data ?? []

  const canFilterAssignee = user?.role === 'admin' || user?.role === 'operations'
  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => crmApi.get<{ data: User[] }>('/users').then((r) => r.data),
    enabled: canFilterAssignee,
  })

  const searchTimeout = useState<ReturnType<typeof setTimeout> | null>(null)
  const handleSearch = (val: string) => {
    setSearch(val)
    if (searchTimeout[0]) clearTimeout(searchTimeout[0])
    searchTimeout[1](setTimeout(() => { setDebouncedSearch(val); setPage(1) }, 300))
  }

  const { data, isLoading } = useQuery({
    queryKey: ['leads', statusFilter, sourceFilter, assignedToFilter, nextContactFilter, createdAtFilter, activityCountFilter, serviceFilter, mineOnly, debouncedSearch, page],
    queryFn: () =>
      crmApi.get<{ data: Lead[]; total: number; page: number; pageSize: number }>('/leads', {
        params: {
          status: statusFilter || undefined,
          source: sourceFilter || undefined,
          assignedTo: assignedToFilter || undefined,
          nextContact: nextContactFilter || undefined,
          createdAt: createdAtFilter || undefined,
          activityCount: activityCountFilter || undefined,
          service: serviceFilter || undefined,
          mine: mineOnly ? 'true' : undefined,
          search: debouncedSearch || undefined,
          page,
          pageSize: PAGE_SIZE,
        },
      }).then((r) => r.data),
  })

  const filtered = data?.data ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: { intendedServices: [] },
  })
  const selectedServices = watch('intendedServices') ?? []
  const toggleService = (svc: string) => {
    const next = selectedServices.includes(svc) ? selectedServices.filter((s) => s !== svc) : [...selectedServices, svc]
    setValue('intendedServices', next, { shouldValidate: true })
  }

  const deleteLead = useMutation({
    mutationFn: (id: string) => crmApi.delete(`/leads/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['leads'] }),
  })

  const createMutation = useMutation({
    mutationFn: (body: CreateForm) => crmApi.post('/leads', body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['leads'] }); setShowCreate(false); reset() },
  })

  const addActivity = useMutation({
    mutationFn: (body: ActivitySubmitData) => crmApi.post('/activities', { ...body, leadId: followUpTarget!.id }),
    onSuccess: () => setFollowUpTarget(null),
  })

  const openFollowUp = (lead: Lead, e: React.MouseEvent) => { e.preventDefault(); setFollowUpTarget(lead) }

  const statusFilterOptions = [
    { value: '', label: t('leads.allLeads') },
    ...leadStatusOpts.map((o) => ({ value: o.value, label: getOptionLabel(leadStatusOpts, o.value) })),
  ]

  const visibleCols = colConfig.filter((c) => c.visible)

  // 状态的悬停说明：丢失显示丢失原因，已转化说明去向，其它显示跟进次数、下次联系和最近更新
  const statusTip = (lead: Lead) => {
    if (lead.status === 'Lost') {
      return t('leads.statusTip.lostReason', { reason: lead.lostReason ? getOptionLabel(lostReasonOpts, lead.lostReason) : t('leads.statusTip.noReason') })
    }
    if (lead.status === 'Converted') return t('leads.statusTip.converted')
    return [
      t('leads.statusTip.activities', { count: lead.activityCount ?? 0 }),
      lead.nextContactDate ? t('leads.statusTip.nextContact', { date: formatDate(lead.nextContactDate) }) : t('leads.statusTip.noNextContact'),
      t('leads.statusTip.updated', { date: formatDate(lead.updatedAt) }),
    ].join('\n')
  }

  const renderTd = (lead: Lead, key: ColKey) => {
    switch (key) {
      case 'leadNo':
        return <td key={key} className={`${tableCls.td} font-mono text-xs text-gray-400`}>L-{String(lead.leadNo ?? '').padStart(4, '0')}</td>
      case 'name':
        return <td key={key} className={`${tableCls.td} font-medium text-gray-900`}><Clip text={lead.name} className="max-w-[10rem]" /></td>
      case 'contactInfo':
        return <td key={key} className={`${tableCls.td} text-gray-600`}><Clip text={lead.contactInfo} className="max-w-[12rem]" /></td>
      case 'intendedServices':
        return (
          <td key={key} className={tableCls.td}>
            <div className="flex gap-1">
              {(lead.intendedServices ?? []).map((svc) => <Badge key={svc} variant="blue">{svc}</Badge>)}
            </div>
          </td>
        )
      case 'status':
        return (
          <td key={key} className={tableCls.td}>
            <Tip tip={statusTip(lead)}>
              <Badge variant={getOptionColor(leadStatusOpts, lead.status)}>{getOptionLabel(leadStatusOpts, lead.status)}</Badge>
            </Tip>
          </td>
        )
      case 'source':
        return <td key={key} className={`${tableCls.td} text-gray-600`}><Clip text={lead.source} className="max-w-[10rem]" /></td>
      case 'assignedToName':
        return <td key={key} className={`${tableCls.td} text-gray-600`}>{lead.assignedToName ?? <span className="text-gray-400">{t('leads.detail.unassigned')}</span>}</td>
      case 'nextContactDate':
        return (
          <td key={key} className={`${tableCls.td} text-xs`}>
            {lead.nextContactDate
              ? <span className={new Date(lead.nextContactDate) < new Date() ? 'text-red-500 font-medium' : 'text-gray-500'}>{formatDate(lead.nextContactDate)}</span>
              : <span className="text-gray-300">—</span>}
          </td>
        )
      case 'activityCount':
        return <td key={key} className={`${tableCls.td} text-xs text-gray-500`}>{lead.activityCount ?? 0}</td>
      case 'createdAt':
        return <td key={key} className={`${tableCls.td} text-gray-500`}>{formatDate(lead.createdAt)}</td>
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title={t('leads.title')}
        summary={`${t('common.total')} ${total} ${t('leads.count')}`}
        actions={<Button onClick={() => setShowCreate(true)} size="sm">{t('leads.new')}</Button>}
      />

      <ListCard
        footer={<Pagination page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} onPageChange={setPage} />}
        toolbar={<div className="sm:flex sm:items-center sm:gap-3">
      {/* 桌面端搜索框与状态标签在同一行；手机上状态标签换到下一行 */}
      <div className="relative sm:w-[26rem] sm:flex-none" ref={filterPanelRef}>
        <SearchBox
          value={search} onChange={handleSearch} placeholder={t('leads.search')}
          filter={{
            label: t('leads.filterBtn'), open: showFilterPanel, onToggle: () => setShowFilterPanel((v) => !v),
            active: !!(sourceFilter || assignedToFilter || nextContactFilter || createdAtFilter || activityCountFilter || serviceFilter),
          }}
        />

        {showFilterPanel && (
          <div className="absolute z-20 top-full left-0 right-0 mt-1 rounded-md border border-gray-200 bg-white p-3 shadow-lg sm:right-auto sm:w-[40rem]">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {sourceOptions.length > 0 && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-500">{t('leads.cols.source')}</label>
                  <select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(1) }} className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary-500">
                    <option value="">{t('leads.filter.allSources')}</option>
                    {sourceOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              )}
              {canFilterAssignee && usersData?.data && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-500">{t('leads.cols.owner')}</label>
                  <select value={assignedToFilter} onChange={(e) => { setAssignedToFilter(e.target.value); setPage(1) }} className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary-500">
                    <option value="">{t('leads.filter.allOwners')}</option>
                    {usersData.data.filter((u) => u.isActive).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">{t('leads.cols.nextContact')}</label>
                <select value={nextContactFilter} onChange={(e) => { setNextContactFilter(e.target.value); setPage(1) }} className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary-500">
                  <option value="">{t('common.all')}</option>
                  <option value="overdue">{t('leads.filter.overdue')}</option>
                  <option value="today">{t('leads.filter.dueToday')}</option>
                  <option value="week">{t('leads.filter.next7Days')}</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">{t('leads.cols.createdAt')}</label>
                <select value={createdAtFilter} onChange={(e) => { setCreatedAtFilter(e.target.value); setPage(1) }} className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary-500">
                  <option value="">{t('leads.filter.allTime')}</option>
                  <option value="today">{t('leads.filter.today')}</option>
                  <option value="week">{t('leads.filter.last7Days')}</option>
                  <option value="month">{t('leads.filter.last30Days')}</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">{t('leads.cols.activityCount')}</label>
                <select value={activityCountFilter} onChange={(e) => { setActivityCountFilter(e.target.value); setPage(1) }} className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary-500">
                  <option value="">{t('common.all')}</option>
                  <option value="0">{t('leads.filter.noActivity')}</option>
                  <option value="1-3">{t('leads.filter.activity1to3')}</option>
                  <option value="3+">{t('leads.filter.activity3plus')}</option>
                </select>
              </div>
              {serviceOptions.length > 0 && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-500">{t('leads.cols.service')}</label>
                  <select value={serviceFilter} onChange={(e) => { setServiceFilter(e.target.value); setPage(1) }} className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary-500">
                    <option value="">{t('leads.filter.allServices')}</option>
                    {serviceOptions.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            {(sourceFilter || assignedToFilter || nextContactFilter || createdAtFilter || activityCountFilter || serviceFilter) && (
              <div className="mt-2 pt-2 border-t border-gray-100 flex justify-end">
                <button onClick={() => { setSourceFilter(''); setAssignedToFilter(''); setNextContactFilter(''); setCreatedAtFilter(''); setActivityCountFilter(''); setServiceFilter(''); setPage(1) }} className="text-xs text-gray-400 hover:text-gray-600">
                  {t('leads.resetFilter')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 min-w-0 sm:mt-0">
        <div className="flex gap-1.5 overflow-x-auto overflow-y-hidden pb-0.5 scrollbar-none sm:pb-0">
          {statusFilterOptions.map(({ value, label }) => (
            <button key={value} onClick={() => { setStatusFilter(value); setPage(1) }} className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${statusFilter === value ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 border hover:bg-gray-50'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      </div>}
      >
      {isLoading ? (
        <ListMessage>{t('common.loading')}</ListMessage>
      ) : !filtered.length ? (
        <ListMessage>{search ? t('leads.noMatch') : t('leads.empty')}</ListMessage>
      ) : (
        <>
          {/* 窄屏时表格横向滚动；列设置弹窗放在滚动区域外，避免被裁切 */}
          <DesktopTable overlay={showColSettings && (
            <div className="absolute right-2 top-10 z-50">
              <div className="relative">
                <ColSettingsPanel config={colConfig} colLabels={colLabels} onChange={updateColConfig} onClose={() => setShowColSettings(false)} />
              </div>
            </div>
          )}>
              <thead className={tableCls.thead}>
                <tr>
                  {visibleCols.map((c) => (
                    <th key={c.key} className={tableCls.th}>{colLabels[c.key]}</th>
                  ))}
                  <th className="sticky right-0 bg-gray-50 px-4 py-2.5 shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.12)]">
                    <div className="flex items-center justify-end gap-1 relative">
                      <button onClick={() => setShowColSettings((v) => !v)} className="text-gray-400 hover:text-gray-600 transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </button>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className={tableCls.tbody}>
                {filtered.map((lead) => (
                  <tr key={lead.id} className={`group cursor-pointer ${tableCls.tr}`} onClick={() => navigate(detailTo(lead.id))}>
                    {visibleCols.map((c) => renderTd(lead, c.key))}
                    {/* 操作列固定在右侧，表格横向滚动时也能看到 */}
                    {/* 点击整行打开详情；操作列的点击不冒泡到行 */}
                    <td className="sticky right-0 cursor-default whitespace-nowrap bg-white px-4 py-2.5 shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.12)] group-hover:bg-gray-50" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={(e) => openFollowUp(lead, e)} className="text-xs text-primary-600 hover:text-primary-800 font-medium">{t('leads.addActivity')}</button>
                        {isAdmin && (
                          <>
                            <span className="text-gray-300">|</span>
                            <button onClick={() => { if (confirm(t('leads.deleteConfirm', { name: lead.name }))) deleteLead.mutate(lead.id) }} className="text-xs text-red-500 hover:text-red-700">{t('common.delete')}</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
          </DesktopTable>

          <MobileList>
            {filtered.map((lead) => (
              <li key={lead.id}>
                <Link to={detailTo(lead.id)} className="block px-3 pt-3 active:bg-gray-50">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{lead.name}</p>
                      <p className="mt-0.5 text-xs text-gray-500 truncate">
                        <span className="font-mono text-gray-400">L-{String(lead.leadNo ?? '').padStart(4, '0')}</span>
                        {lead.contactInfo && <span className="ml-1">{lead.contactInfo}</span>}
                      </p>
                    </div>
                    <Badge variant={getOptionColor(leadStatusOpts, lead.status)} className="flex-shrink-0">
                      {getOptionLabel(leadStatusOpts, lead.status)}
                    </Badge>
                  </div>
                  {(lead.intendedServices ?? []).length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {(lead.intendedServices ?? []).map((svc) => <Badge key={svc} variant="blue">{svc}</Badge>)}
                    </div>
                  )}
                </Link>
                {/* 与客户列表一致：来源、负责人单行截断，跟进按钮在右下角 */}
                <div className="flex items-center gap-2 px-3 pb-2.5 pt-1.5 text-xs">
                  <span className="min-w-0 truncate text-gray-500">
                    {lead.source}
                    {lead.assignedToName ? ` · ${t('leads.detail.owner')} ${lead.assignedToName}` : ` · ${t('leads.detail.unassigned')}`}
                  </span>
                  <span className="shrink-0 text-gray-400">{formatDate(lead.createdAt).slice(5, 10)}</span>
                  <button onClick={(e) => openFollowUp(lead, e)}
                    className="ml-auto shrink-0 rounded-md border border-primary-200 px-2 py-1 font-medium text-primary-600 active:bg-primary-50">
                    {t('leads.addActivity')}
                  </button>
                </div>
              </li>
            ))}
          </MobileList>
        </>
      )}
      </ListCard>

      {showCreate && (
        <Modal title={t('leads.new')} onClose={() => { setShowCreate(false); reset() }}>
          <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-3">
            <Combobox
              label={t('leads.cols.source')}
              error={errors.source?.message}
              value={watch('source') ?? ''}
              onChange={(v) => setValue('source', v, { shouldValidate: true })}
              options={sourceOptions}
              placeholder={t('leads.form.sourcePlaceholder')}
            />
            <Input label={t('common.name')} error={errors.name?.message} {...register('name')} />
            <Input label={t('leads.cols.contact')} error={errors.contactInfo?.message} {...register('contactInfo')} />
            <ContactMatches contact={watch('contactInfo') ?? ''} />
            <div>
              <p className="mb-1.5 text-sm font-medium text-gray-700">{t('leads.cols.service')}</p>
              <div className="flex flex-wrap gap-2">
                {serviceOptions.map((svc) => (
                  <button key={svc.id} type="button" onClick={() => toggleService(svc.name)} className={`rounded-full px-3 py-1 text-sm font-medium border transition-colors ${selectedServices.includes(svc.name) ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-300 hover:border-primary-400'}`}>
                    {svc.name}
                  </button>
                ))}
              </div>
              {errors.intendedServices && <p className="mt-1 text-xs text-red-500">{errors.intendedServices.message}</p>}
            </div>
            <Textarea label={t('leads.form.notes')} {...register('notes')} />
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" type="button" onClick={() => { setShowCreate(false); reset() }}>{t('common.cancel')}</Button>
              <Button type="submit" loading={isSubmitting || createMutation.isPending}>{t('common.create')}</Button>
            </div>
          </form>
        </Modal>
      )}

      {followUpTarget && (
        <ActivityModal
          title={`${t('activityModal.followUp')}${followUpTarget.name}`}
          onClose={() => setFollowUpTarget(null)}
          loading={addActivity.isPending}
          onSubmit={(d) => addActivity.mutate(d)}
          entityType="lead"
        />
      )}
      {openId && (
        <Drawer title={openLead ? `${openLead.name}${openLead.leadNo != null ? ` · L-${String(openLead.leadNo).padStart(4, '0')}` : ''}` : t('common.loading')} onClose={closeDetail}>
          <LeadDetail id={openId} />
        </Drawer>
      )}
    </div>
  )
}
