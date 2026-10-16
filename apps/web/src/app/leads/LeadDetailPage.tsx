import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { crmApi } from '@/shared/utils/request'
import { Button } from '@/shared/components/Button'
import { Badge } from '@/shared/components/Badge'
import { formatDate } from '@/shared/utils/format'
import { useOptionGroup, getOptionLabel, useOptions, parseActivityMeta } from '@/shared/hooks/useOptions'
import { ActivityModal } from '@/shared/components/ActivityModal'
import type { ActivitySubmitData } from '@/shared/components/ActivityModal'
import { AttachmentList } from '@/shared/components/AttachmentList'
import { AiAnalysisCard } from '@/shared/components/AiAnalysisCard'
import { useCrmAuth } from '@/app/auth/CrmAuthContext'
import { VisitorSourceCard } from '@/app/analytics/Journey'
import { useWorkflows } from '@/shared/hooks/useWorkflows'
import type { ActivityConfig } from '@/shared/hooks/useWorkflows'
import type { Lead, LeadStatus, SalesActivity, User } from '@/shared/types'
import { useState } from 'react'

export default function LeadDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user: me } = useCrmAuth()
  const [showActivity, setShowActivity] = useState(false)
  const [assigningUserId, setAssigningUserId] = useState<string | null | undefined>(undefined)
  const [pendingStatus, setPendingStatus] = useState<string | null>(null)
  const [pendingPolicy, setPendingPolicy] = useState<ActivityConfig | null>(null)

  const { getActivityConfig } = useWorkflows('lead')
  const [transitionError, setTransitionError] = useState<string | null>(null)

  const canAssign = me?.role === 'admin' || me?.role === 'operations'

  const { options: leadStatusOpts } = useOptionGroup('lead_status')
  const { options: activityTypeOpts } = useOptionGroup('activity_type')
  const { data: allOptions } = useOptions()

  const { data: lead } = useQuery({
    queryKey: ['lead', id],
    queryFn: () => crmApi.get<{ data: Lead }>(`/leads/${id}`).then((r) => r.data.data),
  })

  const { data: activities } = useQuery({
    queryKey: ['activities', 'lead', id],
    queryFn: () =>
      crmApi.get<{ data: SalesActivity[] }>('/activities', { params: { leadId: id } }).then((r) => r.data.data),
  })

  // 用于分配负责人的用户列表（仅 sales 角色）
  const { data: usersData } = useQuery({
    queryKey: ['users-sales'],
    queryFn: () =>
      crmApi.get<{ data: User[] }>('/users').then((r) =>
        r.data.data.filter((u) => u.role === 'sales'),
      ),
    enabled: canAssign,
  })
  const salesUsers = usersData ?? []

  const updateStatus = useMutation({
    mutationFn: (status: LeadStatus) => crmApi.put(`/leads/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lead', id] }),
  })

  const statusTransition = useMutation({
    mutationFn: (body: { targetStatus: string; activity: ActivitySubmitData }) =>
      crmApi.post(`/leads/${id}/status-transition`, {
        targetStatus: body.targetStatus,
        activity: {
          activityType: body.activity.activityType,
          description: body.activity.description,
          activityDate: body.activity.activityDate,
          attachmentKeys: body.activity.attachmentKeys,
        },
        fields: body.activity.policyFields,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead', id] })
      queryClient.invalidateQueries({ queryKey: ['activities', 'lead', id] })
      setPendingStatus(null)
      setPendingPolicy(null)
      setTransitionError(null)
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setTransitionError(msg ?? t('common.opFailed'))
    },
  })

  const handleStatusClick = (status: string) => {
    const policy = getActivityConfig('status', status)
    if (policy?.requireActivity || (policy?.requiredFields.length ?? 0) > 0) {
      setPendingStatus(status)
      setPendingPolicy(policy)
    } else {
      updateStatus.mutate(status as LeadStatus)
    }
  }

  const assignLead = useMutation({
    mutationFn: (assignedToUserId: string | null) =>
      crmApi.put(`/leads/${id}`, { assignedToUserId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead', id] })
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      setAssigningUserId(undefined)
    },
  })

  const convertToClient = useMutation({
    mutationFn: () =>
      crmApi.post('/clients', {
        leadId: id,
        name: lead?.name,
        phone: lead?.contactInfo,
        servicePlans: lead?.intendedServices ?? [],
        assignedSalesUserId: lead?.assignedToUserId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      navigate('/app/clients')
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
    mutationFn: (body: ActivitySubmitData) => crmApi.post('/activities', { ...body, leadId: id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['activities', 'lead', id] })
      setShowActivity(false)
    },
  })

  if (!lead) return <div className="p-6 text-sm text-gray-500">{t('common.loading')}</div>

  // 判断是否正在编辑分配：undefined=未进入编辑，null=选择"取消分配"，string=选择了某用户
  const isEditingAssign = assigningUserId !== undefined
  const isConverted = lead.status === 'Converted'

  return (
    <div className="p-4 sm:p-6 max-w-3xl">
      <button onClick={() => navigate(-1)} className="mb-4 text-sm text-gray-500 hover:text-gray-700">
        ← {t('common.back')}
      </button>

      {/* 已转化提示 */}
      {isConverted && (
        <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-4 py-2.5 text-sm text-green-700">
          {t('leads.convertedNotice')}
        </div>
      )}

      {/* 基本信息 */}
      <div className="rounded-lg border bg-white p-4 sm:p-6 mb-4 sm:mb-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-gray-900">{lead.name}</h1>
              {lead.leadNo != null && (
                <span className="font-mono text-sm text-gray-400">L-{String(lead.leadNo).padStart(4, '0')}</span>
              )}
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-500">
              <button
                type="button"
                title={t('common.copyNumber')}
                onClick={() => navigator.clipboard.writeText(lead.contactInfo)}
                className="font-medium text-gray-700 hover:text-primary-600 hover:underline"
              >
                {lead.contactInfo}
              </button>
              {/* 拨打按钮仅移动端显示 */}
              <a
                href={`tel:${lead.contactInfo}`}
                title={t('common.call')}
                className="md:hidden rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-green-600"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </a>
              · {lead.source}
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {(lead.intendedServices ?? []).map((svc) => (
              <Badge key={svc}>{svc}</Badge>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-600">{t('leads.detail.status')}</span>
          {isConverted ? (
            <Badge variant="green">{getOptionLabel(leadStatusOpts, lead.status)}</Badge>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {leadStatusOpts.filter((o) => o.value !== 'Converted').map((o) => (
                <button
                  key={o.value}
                  onClick={() => handleStatusClick(o.value)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    lead.status === o.value
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 负责人行 */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-600">{t('leads.detail.owner')}</span>
          {!isEditingAssign ? (
            <>
              <span className={`text-sm ${lead.assignedToName ? 'font-medium text-gray-900' : 'text-gray-400'}`}>
                {lead.assignedToName ?? t('leads.detail.unassigned')}
              </span>
              {canAssign && !isConverted && (
                <button
                  onClick={() => setAssigningUserId(lead.assignedToUserId ?? null)}
                  className="text-xs text-primary-600 hover:text-primary-800 underline"
                >
                  {lead.assignedToUserId ? t('leads.detail.change') : t('leads.detail.assign')}
                </button>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2">
              <select
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                value={assigningUserId ?? ''}
                onChange={(e) => setAssigningUserId(e.target.value || null)}
              >
                <option value="">— {t('leads.detail.unassign')} —</option>
                {salesUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
              <Button
                size="sm"
                loading={assignLead.isPending}
                onClick={() => assignLead.mutate(assigningUserId ?? null)}
              >
                {t('common.confirm')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setAssigningUserId(undefined)}
              >
                {t('common.cancel')}
              </Button>
            </div>
          )}
        </div>

        {lead.notes && (
          <p className="mt-3 text-sm text-gray-600 bg-gray-50 rounded p-3">{lead.notes}</p>
        )}

        {/* 状态附加字段 */}
        {((lead.status === 'Lost' && lead.lostReason) || lead.nextContactDate) && (
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {lead.status === 'Lost' && lead.lostReason && (
              <span className="text-gray-600">
                {t('leads.detail.lostReason')}<span className="font-medium text-red-600">
                  {getOptionLabel(allOptions?.['lost_reason'] ?? [], lead.lostReason)}
                </span>
              </span>
            )}
            {lead.nextContactDate && (
              <span className="text-gray-600">
                {t('leads.detail.nextContact')}<span className="font-medium text-gray-900">{formatDate(lead.nextContactDate)}</span>
              </span>
            )}
          </div>
        )}

        {lead.adInfo && Object.keys(lead.adInfo).length > 0 && (
          <div className="mt-4 rounded border border-blue-100 bg-blue-50 p-3">
            <p className="mb-1.5 text-xs font-medium text-blue-700">{t('leads.detail.adInfo')}</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {Object.entries(lead.adInfo).map(([k, v]) => (
                <span key={k} className="text-xs text-gray-600">
                  {k}：<span className="font-medium text-gray-900">{v}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
          <span>{t('leads.detail.createdBy')}{lead.createdByName ?? '—'}</span>
          <span>{t('leads.detail.createdAt')} {formatDate(lead.createdAt)}</span>
        </div>

        {lead.status !== 'Converted' && lead.status !== 'Lost' && (
          <div className="mt-4 pt-4 border-t">
            <Button
              variant="primary"
              size="sm"
              onClick={() => convertToClient.mutate()}
              loading={convertToClient.isPending}
            >
              {t('leads.convertToClient')}
            </Button>
          </div>
        )}
      </div>

      {/* 网站来源（留资时关联的访客） */}
      <VisitorSourceCard url={`/leads/${id}/attribution`} />

      {/* 跟进记录 */}
      <div className="rounded-lg border bg-white p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">{t('leads.detail.activities')}</h2>
          <Button size="sm" variant="secondary" onClick={() => setShowActivity(true)}>
            {t('leads.detail.addActivity')}
          </Button>
        </div>

        {!activities?.length ? (
          <p className="text-sm text-gray-500">{t('leads.detail.noActivities')}</p>
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
                    <p className="mt-1 text-xs text-primary-600">{t('leads.detail.nextContact')}{formatDate(act.nextContactDate)}</p>
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
      </div>

      {/* AI 分析 */}
      <AiAnalysisCard
        entityType="lead"
        entityId={id!}
        onActionExecuted={() => {
          queryClient.invalidateQueries({ queryKey: ['lead', id] })
          queryClient.invalidateQueries({ queryKey: ['activities', 'lead', id] })
        }}
      />

      {/* 添加跟进记录弹窗 */}
      {showActivity && (
        <ActivityModal
          title={t('activityModal.title')}
          onClose={() => setShowActivity(false)}
          loading={addActivity.isPending}
          onSubmit={(d) => addActivity.mutate(d)}
          entityType="lead"
        />
      )}

      {/* 字段策略触发的跟进弹窗 */}
      {pendingStatus && pendingPolicy && (
        <ActivityModal
          title={t('leads.detail.changeStatus', { status: getOptionLabel(leadStatusOpts, pendingStatus) })}
          onClose={() => { setPendingStatus(null); setPendingPolicy(null); setTransitionError(null) }}
          loading={statusTransition.isPending}
          activityConfig={pendingPolicy}
          serverError={transitionError ?? undefined}
          initialPolicyValues={
            pendingStatus === 'Qualified'
              ? {
                  intendedServices: lead.intendedServices ?? [],
                  nextContactDate: (() => { const d = new Date(); d.setDate(d.getDate() + 3); return d.toLocaleDateString('en-CA') })(),
                }
              : {}
          }
          onSubmit={(d) =>
            statusTransition.mutate({ targetStatus: pendingStatus, activity: d })
          }
        />
      )}
    </div>
  )
}
