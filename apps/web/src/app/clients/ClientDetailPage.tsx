import { VisitorSourceCard } from '@/app/analytics/Journey'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { crmApi } from '@/shared/utils/request'
import { Button } from '@/shared/components/Button'
import { Input } from '@/shared/components/Input'
import { Select } from '@/shared/components/Select'
import { Badge } from '@/shared/components/Badge'
import { Modal } from '@/shared/components/Modal'
import { formatDate } from '@/shared/utils/format'
import type { Client, SalesActivity, Service } from '@/shared/types'

interface Milestone {
  id: string
  clientId: string
  serviceId: string
  serviceName: string
  stepIndex: number
  stepName: string
  status: 'pending' | 'in_progress' | 'completed' | 'skipped'
  expectedDate: string | null
  completedDate: string | null
  notes: string | null
}
import { useOptionGroup, toSelectOptions, getOptionColor, getOptionLabel, parseActivityMeta } from '@/shared/hooks/useOptions'
import { ActivityModal } from '@/shared/components/ActivityModal'
import type { ActivitySubmitData } from '@/shared/components/ActivityModal'
import { AttachmentList } from '@/shared/components/AttachmentList'
import { AskAiButton } from '@/shared/components/AskAiButton'

const editSchema = z.object({
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  servicePlans: z.array(z.string()).optional(),
  contractStatus: z.string().nullable().optional(),
})
type EditForm = z.infer<typeof editSchema>

const STATUS_CONFIG = {
  pending:     { color: 'bg-gray-200',    text: 'text-gray-400',   label: 'milestone.pending' },
  in_progress: { color: 'bg-primary-500', text: 'text-primary-600', label: 'milestone.inProgress' },
  completed:   { color: 'bg-green-500',   text: 'text-green-600',  label: 'milestone.completed' },
  skipped:     { color: 'bg-gray-300',    text: 'text-gray-400',   label: 'milestone.skipped' },
}

function MilestonesTab({
  milestones, isLoading, services, editingId, setEditingId, notesRef,
  onInit, onUpdate, isInitPending, isUpdatePending,
}: {
  milestones: Milestone[]
  isLoading: boolean
  services: Service[]
  editingId: string | null
  setEditingId: (id: string | null) => void
  notesRef: React.MutableRefObject<Record<string, string>>
  onInit: (serviceId: string) => void
  onUpdate: (id: string, patch: { status?: string; expectedDate?: string | null; completedDate?: string | null; notes?: string | null }) => void
  isInitPending: boolean
  isUpdatePending: boolean
}) {
  const { t } = useTranslation()

  // 按服务分组
  const byService: Record<string, { name: string; items: Milestone[] }> = {}
  for (const m of milestones) {
    if (!byService[m.serviceId]) byService[m.serviceId] = { name: m.serviceName, items: [] }
    byService[m.serviceId]!.items.push(m)
  }

  if (isLoading) return <p className="text-sm text-gray-400 py-4">{t('common.loading')}</p>

  return (
    <div className="space-y-6">
      {/* 无里程碑：初始化 */}
      {milestones.length === 0 && (
        <div>
          <p className="text-sm text-gray-500 mb-3">{t('milestone.noMilestones')}</p>
          <div className="flex flex-wrap gap-2">
            {services.filter((s) => (s.processSteps ?? []).length > 0).map((s) => (
              <button
                key={s.id}
                onClick={() => onInit(s.id)}
                disabled={isInitPending}
                className="rounded-lg border border-primary-300 bg-primary-50 px-3 py-1.5 text-sm text-primary-700 hover:bg-primary-100 transition-colors disabled:opacity-50"
              >
                {isInitPending ? t('common.loading') : `${t('milestone.initFrom')} "${s.name}"`}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 各服务里程碑 */}
      {Object.values(byService).map(({ name, items }) => {
        const completed = items.filter((m) => m.status === 'completed').length
        const pct = Math.round((completed / items.length) * 100)
        return (
          <div key={name}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-700">{name}</span>
              <span className="text-xs text-gray-400">{completed}/{items.length} · {pct}%</span>
            </div>
            {/* 进度条 */}
            <div className="h-1.5 bg-gray-100 rounded-full mb-4 overflow-hidden">
              <div className="h-full bg-primary-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
            {/* 步骤列表 */}
            <div className="space-y-2">
              {items.map((m, idx) => {
                const cfg = STATUS_CONFIG[m.status]
                const isEditing = editingId === m.id
                return (
                  <div key={m.id} className={`rounded-lg border p-3 transition-colors ${m.status === 'in_progress' ? 'border-primary-200 bg-primary-50/30' : 'bg-white'}`}>
                    <div className="flex items-center gap-3">
                      <div className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full text-white text-xs font-bold" style={{ background: m.status === 'completed' ? '#22c55e' : m.status === 'in_progress' ? '#6366f1' : '#d1d5db' }}>
                        {m.status === 'completed' ? '✓' : idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm font-medium ${m.status === 'skipped' ? 'line-through text-gray-400' : 'text-gray-900'}`}>{m.stepName}</span>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                          <span className={`text-xs font-medium ${cfg.text}`}>{t(cfg.label)}</span>
                          {m.completedDate && <span className="text-xs text-gray-400">{t('milestone.completedOn')} {formatDate(m.completedDate)}</span>}
                          {m.expectedDate && !m.completedDate && <span className="text-xs text-gray-400">{t('milestone.expectedOn')} {formatDate(m.expectedDate)}</span>}
                        </div>
                        {m.notes && !isEditing && <p className="mt-1 text-xs text-gray-500">{m.notes}</p>}
                      </div>
                      <button
                        onClick={() => { setEditingId(isEditing ? null : m.id); if (!notesRef.current[m.id]) notesRef.current[m.id] = m.notes ?? '' }}
                        className="flex-shrink-0 text-xs text-gray-400 hover:text-primary-600"
                      >
                        {isEditing ? t('common.cancel') : t('common.edit')}
                      </button>
                    </div>

                    {isEditing && (
                      <div className="mt-3 space-y-2 pl-9">
                        <div className="flex gap-2 flex-wrap">
                          {(['pending', 'in_progress', 'completed', 'skipped'] as const).map((s) => (
                            <button
                              key={s}
                              onClick={() => onUpdate(m.id, { status: s })}
                              disabled={isUpdatePending}
                              className={`rounded-full px-2.5 py-0.5 text-xs border transition-colors ${
                                m.status === s
                                  ? 'bg-primary-600 text-white border-primary-600'
                                  : 'bg-white text-gray-600 border-gray-300 hover:border-primary-400'
                              }`}
                            >
                              {t(STATUS_CONFIG[s].label)}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="date"
                            defaultValue={m.expectedDate ?? ''}
                            placeholder={t('milestone.expectedOn')}
                            onChange={(e) => notesRef.current[`${m.id}_exp`] = e.target.value}
                            className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary-500"
                          />
                        </div>
                        <div className="flex gap-2">
                          <textarea
                            rows={2}
                            defaultValue={m.notes ?? ''}
                            placeholder={t('milestone.notesHint')}
                            onChange={(e) => notesRef.current[m.id] = e.target.value}
                            className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none"
                          />
                          <button
                            onClick={() => onUpdate(m.id, {
                              notes: notesRef.current[m.id] ?? null,
                              expectedDate: notesRef.current[`${m.id}_exp`] || null,
                            })}
                            disabled={isUpdatePending}
                            className="self-end rounded bg-primary-600 text-white px-3 py-1 text-xs hover:bg-primary-700 disabled:opacity-50"
                          >
                            {t('common.save')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            {/* 追加服务入口（当有多个服务时） */}
            {services.filter((s) => (s.processSteps ?? []).length > 0 && !Object.keys(byService).includes(s.id)).length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {services.filter((s) => (s.processSteps ?? []).length > 0 && !Object.keys(byService).includes(s.id)).map((s) => (
                  <button key={s.id} onClick={() => onInit(s.id)} disabled={isInitPending}
                    className="text-xs text-gray-400 hover:text-primary-600 border border-dashed border-gray-300 rounded px-2 py-1 hover:border-primary-400 transition-colors">
                    + {t('milestone.initFrom')} "{s.name}"
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** 客户详情：在列表页的抽屉里显示（见 ClientsPage） */
export function ClientDetail({ id }: { id: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [showEdit, setShowEdit] = useState(false)
  const [showActivity, setShowActivity] = useState(false)
  const [activeTab, setActiveTab] = useState<'activities' | 'milestones'>('activities')
  const [editingMilestoneId, setEditingMilestoneId] = useState<string | null>(null)
  const milestoneNotesRef = useRef<Record<string, string>>({})

  const { options: contractStatusOpts } = useOptionGroup('contract_status')
  const { options: activityTypeOpts } = useOptionGroup('activity_type')

  const { data: servicesData } = useQuery({
    queryKey: ['services'],
    queryFn: () => crmApi.get<{ data: Service[] }>('/services').then((r) => r.data),
  })
  const serviceOptions = servicesData?.data ?? []

  const { data: client } = useQuery({
    queryKey: ['client', id],
    queryFn: () => crmApi.get<{ data: Client }>(`/clients/${id}`).then((r) => r.data.data),
  })

  const { data: activities } = useQuery({
    queryKey: ['activities', 'client', id, client?.leadId],
    enabled: !!client,
    queryFn: () =>
      crmApi.get<{ data: SalesActivity[] }>('/activities', {
        params: { clientId: id, ...(client?.leadId ? { leadId: client.leadId } : {}) },
      }).then((r) => r.data.data),
  })

  const editForm = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    ...(client ? {
      values: {
        phone: client.phone,
        email: client.email,
        servicePlans: client.servicePlans ?? [],
        contractStatus: client.contractStatus,
      }
    } : {}),
  })

  const selectedPlans = editForm.watch('servicePlans') ?? []

  const togglePlan = (svcName: string) => {
    const next = selectedPlans.includes(svcName)
      ? selectedPlans.filter((s) => s !== svcName)
      : [...selectedPlans, svcName]
    editForm.setValue('servicePlans', next)
  }

  const updateClient = useMutation({
    mutationFn: (body: EditForm) => crmApi.put(`/clients/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] })
      setShowEdit(false)
    },
  })

  const _downloadFile = async (key: string, name: string) => {
    const res = await crmApi.get('/upload/file', { params: { key }, responseType: 'blob' })
    const url = URL.createObjectURL(res.data as Blob)
    const a = document.createElement('a')
    a.href = url; a.download = name; a.click()
    URL.revokeObjectURL(url)
  }

  const addActivity = useMutation({
    mutationFn: (body: ActivitySubmitData) => crmApi.post('/activities', { ...body, clientId: id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activities', 'client', id] })
      queryClient.invalidateQueries({ queryKey: ['milestones', id] })
      setShowActivity(false)
    },
  })

  const { data: milestonesData, isLoading: milestonesLoading } = useQuery({
    queryKey: ['milestones', id],
    queryFn: () => crmApi.get<{ data: Milestone[] }>('/milestones', { params: { clientId: id } }).then((r) => r.data.data),
  })
  const milestones = milestonesData ?? []

  const initMilestones = useMutation({
    mutationFn: (serviceId: string) => crmApi.post('/milestones/init', { clientId: id, serviceId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['milestones', id] }),
  })

  const updateMilestone = useMutation({
    mutationFn: ({ milestoneId, ...body }: { milestoneId: string; status?: string; expectedDate?: string | null; completedDate?: string | null; notes?: string | null }) =>
      crmApi.put(`/milestones/${milestoneId}`, body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['milestones', id] }); setEditingMilestoneId(null) },
  })

  if (!client) return <div className="p-6 text-sm text-gray-500">{t('common.loading')}</div>

  return (
    <div>

      {/* 基本信息卡片 */}
      <div className="rounded-lg border bg-white p-4 sm:p-6 mb-4 sm:mb-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-gray-900">{client.name}</h1>
              {client.leadNo != null && (
                <span className="font-mono text-sm text-gray-400">L-{String(client.leadNo).padStart(4, '0')}</span>
              )}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {client.phone ?? t('clients.detail.noPhone')} · {client.email ?? t('clients.detail.noEmail')}
            </p>
          </div>
          <div className="flex flex-wrap gap-1 max-w-[50%] justify-end">
            {(client.servicePlans ?? []).map((p) => <Badge key={p} variant="blue">{p}</Badge>)}
          </div>
        </div>

        {/* 合同状态 */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-600">{t('clients.detail.contractStatus')}</span>
          {client.contractStatus ? (
            <Badge variant={getOptionColor(contractStatusOpts, client.contractStatus)}>
              {getOptionLabel(contractStatusOpts, client.contractStatus)}
            </Badge>
          ) : (
            <span className="text-sm text-gray-400">{t('clients.detail.notSet')}</span>
          )}
          <button
            onClick={() => setShowEdit(true)}
            className="text-xs text-primary-600 hover:text-primary-800 underline"
          >
            {t('common.edit')}
          </button>
        </div>

        {client.detailedProfile?.notes && (
          <p className="mt-3 text-sm text-gray-600 bg-gray-50 rounded p-3">{String(client.detailedProfile.notes)}</p>
        )}

        {/* 附加字段：下次联系 */}
        {client.nextContactDate && (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            <span className="text-gray-600">
              {t('clients.detail.nextContact')}<span className="font-medium text-gray-900">{formatDate(client.nextContactDate)}</span>
            </span>
          </div>
        )}

        {/* 元信息 */}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
          {client.detailedProfile?.source && <span>{t('clients.detail.source')}{String(client.detailedProfile.source)}</span>}
          <span>{t('leads.detail.createdBy')}{client.createdByName ?? '—'}</span>
          <span>{t('leads.detail.createdAt')} {formatDate(client.createdAt)}</span>
        </div>
      </div>

      {/* 网站来源（转化前线索关联的访客） */}
      <VisitorSourceCard url={`/clients/${id}/attribution`} />

      {/* Tab 切换 */}
      <div className="rounded-lg border bg-white overflow-hidden">
        <div className="flex border-b">
          {(['activities', 'milestones'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'text-primary-700 border-b-2 border-primary-600 bg-white'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {tab === 'activities' ? t('clients.detail.activities') : t('clients.detail.milestones')}
              {tab === 'milestones' && milestones.length > 0 && (
                <span className="ml-1.5 text-xs text-gray-400">
                  ({milestones.filter((m) => m.status === 'completed').length}/{milestones.length})
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="p-4 sm:p-6">
        {activeTab === 'activities' && (<>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">{t('clients.detail.activities')}</h2>
          <Button size="sm" variant="secondary" onClick={() => setShowActivity(true)}>
            {t('clients.detail.addActivity')}
          </Button>
        </div>

        {!activities?.length ? (
          <p className="text-sm text-gray-500">{t('clients.detail.noActivities')}</p>
        ) : (
          <div className="space-y-3">
            {activities.map((act) => (
              <div key={act.id} className="flex gap-3 text-sm border-l-2 border-gray-200 pl-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-gray-600">
                      {getOptionLabel(activityTypeOpts, act.activityType)}
                    </span>
                    <span className="text-xs text-gray-400">{act.userName ?? '—'}</span>
                    <span className="text-xs text-gray-400">{formatDate(act.activityDate)}</span>
                  </div>
                  {act.description && (
                    <p className="mt-1 text-gray-700 whitespace-pre-line">{act.description}</p>
                  )}
                  {act.nextContactDate && (
                    <p className="mt-1 text-xs text-primary-600">{t('clients.detail.nextContact')}{formatDate(act.nextContactDate)}</p>
                  )}
                  {act.extraData && Object.keys(act.extraData).length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5">
                      {Object.entries(act.extraData as Record<string, unknown>).map(([k, v]) => {
                        const field = parseActivityMeta(activityTypeOpts.find((o) => o.value === act.activityType) ?? {} as Parameters<typeof parseActivityMeta>[0])?.fields?.find((f) => f.key === k)
                        return (
                          <span key={k} className="text-xs text-gray-500">
                            {field?.label ?? k}：<span className="font-medium text-gray-800">{String(v)}{field?.unit ? ` ${field.unit}` : ''}</span>
                          </span>
                        )
                      })}
                    </div>
                  )}
                  <AttachmentList attachments={act.attachments ?? []} />
                </div>
              </div>
            ))}
          </div>
        )}
        </>)}

        {activeTab === 'milestones' && (
          <MilestonesTab
            milestones={milestones}
            isLoading={milestonesLoading}
            services={serviceOptions}
            editingId={editingMilestoneId}
            setEditingId={setEditingMilestoneId}
            notesRef={milestoneNotesRef}
            onInit={(serviceId) => initMilestones.mutate(serviceId)}
            onUpdate={(milestoneId, patch) => updateMilestone.mutate({ milestoneId, ...patch })}
            isInitPending={initMilestones.isPending}
            isUpdatePending={updateMilestone.isPending}
          />
        )}
        </div>
      </div>

      {/* 让 AI 分析：打开 AI 助手 */}
      <AskAiButton prompt={t('ai.ask.clientPrompt', { name: client.name, id })} />

      {/* 编辑弹窗 */}
      {showEdit && (
        <Modal
          title={t('clients.detail.editTitle')}
          onClose={() => setShowEdit(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setShowEdit(false)}>{t('common.cancel')}</Button>
              <Button
                loading={updateClient.isPending}
                onClick={editForm.handleSubmit((d) => updateClient.mutate(d))}
              >
                {t('common.save')}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Input label={t('common.phone')} {...editForm.register('phone')} />
            <Input label={t('common.email')} type="email" {...editForm.register('email')} />
            <div>
              <p className="mb-1.5 text-sm font-medium text-gray-700">{t('clients.cols.plan')}</p>
              <div className="flex flex-wrap gap-2">
                {serviceOptions.map((svc) => (
                  <button
                    key={svc.id}
                    type="button"
                    onClick={() => togglePlan(svc.name)}
                    className={`rounded-full px-3 py-1 text-sm font-medium border transition-colors ${
                      selectedPlans.includes(svc.name)
                        ? 'bg-primary-600 text-white border-primary-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-primary-400'
                    }`}
                  >
                    {svc.name}
                  </button>
                ))}
              </div>
            </div>
            <Select
              label={t('clients.cols.contractStatus')}
              options={toSelectOptions(contractStatusOpts)}
              placeholder={t('clients.detail.planPlaceholder')}
              value={editForm.watch('contractStatus') ?? ''}
              onChange={(e) => editForm.setValue('contractStatus', e.target.value || null)}
            />
          </div>
        </Modal>
      )}

      {/* 添加跟进记录弹窗 */}
      {showActivity && (
        <ActivityModal
          title={t('activityModal.title')}
          onClose={() => setShowActivity(false)}
          loading={addActivity.isPending}
          onSubmit={(d) => addActivity.mutate(d)}
          showNextContact
          entityType="client"
        />
      )}
    </div>
  )
}
