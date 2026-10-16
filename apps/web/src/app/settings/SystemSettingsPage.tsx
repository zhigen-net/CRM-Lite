import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { crmApi } from '@/shared/utils/request'
import { formatDate } from '@/shared/utils/format'
import { Input } from '@/shared/components/Input'
import { Textarea } from '@/shared/components/Textarea'
import { Button } from '@/shared/components/Button'
import { Modal } from '@/shared/components/Modal'
import { Badge } from '@/shared/components/Badge'
import type { Team } from '@/shared/types'
import type { OptionItem, ActivityMeta, ActivityMetaField, MilestoneMapping } from '@/shared/hooks/useOptions'
import { useOptions, parseActivityMeta } from '@/shared/hooks/useOptions'
import type { Workflow } from '@/shared/hooks/useWorkflows'

// ─── 选项配置相关常量和组件 ───────────────────────────────────────────────────

const VALID_COLORS = ['gray', 'blue', 'green', 'yellow', 'red', 'purple'] as const
type Color = typeof VALID_COLORS[number]

const COLOR_CLASS: Record<Color, string> = {
  gray:   'bg-gray-200',
  blue:   'bg-blue-400',
  green:  'bg-green-400',
  yellow: 'bg-yellow-400',
  red:    'bg-red-400',
  purple: 'bg-purple-400',
}

const OPTION_GROUPS_KEYS = [
  { key: 'lead_status',     labelKey: 'settings.options.leadStatus',    noAdd: true },
  { key: 'contract_status', labelKey: 'settings.options.contractStatus', noAdd: false },
  { key: 'activity_type',   labelKey: 'settings.options.activityTypes',  noAdd: false },
  { key: 'partner_type',    labelKey: 'settings.options.partnerTypes',   noAdd: false },
]

const optionItemSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
  color: z.enum(VALID_COLORS).default('gray'),
})
type OptionItemForm = z.infer<typeof optionItemSchema>

function ColorPicker({ value, onChange }: { value: Color; onChange: (c: Color) => void }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {VALID_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`w-6 h-6 rounded-full ${COLOR_CLASS[c]} ${
            value === c ? 'ring-2 ring-offset-1 ring-primary-600' : 'opacity-70 hover:opacity-100'
          }`}
          title={c}
        />
      ))}
    </div>
  )
}

// ─── 工作流管理面板 ───────────────────────────────────────────────────────────

const ENTITY_LABEL_KEYS: Record<string, string> = { lead: 'settings.workflow.trigger.targets.lead', client: 'settings.workflow.trigger.targets.client' }

interface EntityField {
  field: string
  label: string
  type: 'select' | 'datetime' | 'services' | 'text' | 'user'
  optionGroup?: string
  triggerOnly?: boolean
}

type ReqField = { field: string; label: string; type: 'datetime' | 'select' | 'services' | 'text'; optionGroup?: string }

type WfTriggerType = 'field_change' | 'on_create' | 'scheduled'
type ScheduledCondition = 'date_is_today' | 'date_overdue' | 'no_activity_days'

type WfActionForm =
  | { type: 'require_activity'; contentRequired: boolean; contentPresets: string }
  | { type: 'require_fields';   fields: ReqField[] }
  | { type: 'set_field';        field: string; label: string; value: string }
  | { type: 'send_email';       to: string; subject: string; body: string }
  | { type: 'webhook';          url: string; method: 'POST' | 'GET'; body: string }
  | { type: 'ai_analysis';      autoExecute: string }

type WorkflowForm = {
  name: string
  entityType: string
  triggerType: WfTriggerType
  triggerField: string          // field_change / scheduled(date_*) only
  triggerValue: string          // field_change only（'*' = 任意值）
  scheduledCondition: ScheduledCondition
  scheduledDays: number         // no_activity_days only
  actions: WfActionForm[]
}

const EMPTY_WORKFLOW: WorkflowForm = {
  name: '', entityType: 'lead', triggerType: 'field_change',
  triggerField: '', triggerValue: '',
  scheduledCondition: 'date_is_today', scheduledDays: 7,
  actions: [],
}

const TRIGGER_TYPE_KEYS: { type: WfTriggerType; labelKey: string; descKey: string }[] = [
  { type: 'field_change', labelKey: 'settings.workflow.trigger.types.field_change', descKey: 'settings.workflow.trigger.types.field_changeHint' },
  { type: 'on_create',    labelKey: 'settings.workflow.trigger.types.on_create',    descKey: 'settings.workflow.trigger.types.on_createHint' },
  { type: 'scheduled',    labelKey: 'settings.workflow.trigger.types.scheduled',    descKey: 'settings.workflow.trigger.types.scheduledHint' },
]

const SCHEDULED_CONDITIONS: { value: ScheduledCondition; labelKey: string; needsField: boolean; needsDays: boolean }[] = [
  { value: 'date_is_today',    labelKey: 'settings.workflow.trigger.types.date_equals_today', needsField: true,  needsDays: false },
  { value: 'date_overdue',     labelKey: 'settings.workflow.trigger.types.date_overdue',      needsField: true,  needsDays: false },
  { value: 'no_activity_days', labelKey: 'settings.workflow.trigger.types.no_activity',       needsField: false, needsDays: true  },
]

const ACTION_TYPE_KEYS: { type: WfActionForm['type']; labelKey: string; supported: boolean }[] = [
  { type: 'require_activity', labelKey: 'settings.workflow.actions.types.require_activity', supported: true },
  { type: 'require_fields',   labelKey: 'settings.workflow.actions.types.require_fields',   supported: true },
  { type: 'set_field',        labelKey: 'settings.workflow.actions.types.set_field',        supported: true },
  { type: 'send_email',       labelKey: 'settings.workflow.actions.types.send_email',       supported: true },
  { type: 'webhook',          labelKey: 'settings.workflow.actions.types.webhook',          supported: true },
  { type: 'ai_analysis',      labelKey: 'settings.workflow.actions.types.ai_analysis',      supported: true },
]

const ACTION_LABEL_KEYS: Record<WfActionForm['type'], string> = {
  require_activity: 'settings.workflow.actions.types.require_activity',
  require_fields:   'settings.workflow.actions.types.require_fields',
  set_field:        'settings.workflow.actions.types.set_field',
  send_email:       'settings.workflow.actions.types.send_email',
  webhook:          'settings.workflow.actions.types.webhook',
  ai_analysis:      'settings.workflow.actions.types.ai_analysis',
}

function buildTrigger(f: WorkflowForm) {
  if (f.triggerType === 'on_create') return { type: 'on_create' as const }
  if (f.triggerType === 'scheduled') {
    const cond = f.scheduledCondition
    return {
      type: 'scheduled' as const,
      condition: cond,
      ...(SCHEDULED_CONDITIONS.find((c) => c.value === cond)?.needsField ? { field: f.triggerField } : {}),
      ...(cond === 'no_activity_days' ? { days: f.scheduledDays } : {}),
    }
  }
  return { type: 'field_change' as const, field: f.triggerField, to: f.triggerValue }
}

function buildWorkflowPayload(f: WorkflowForm) {
  const entityLabel = f.entityType === 'lead' ? 'Lead' : 'Client'
  const triggerDesc = f.triggerType === 'on_create'
    ? 'on_create'
    : f.triggerType === 'scheduled'
    ? `scheduled·${f.scheduledCondition}`
    : `${f.triggerField} → ${f.triggerValue === '*' ? '*' : f.triggerValue}`
  const name = f.name.trim() || `${entityLabel} · ${triggerDesc}`
  return {
    name,
    entityType: f.entityType,
    trigger: buildTrigger(f),
    conditions: [],
    actions: f.actions.map((a) => {
      if (a.type === 'require_activity') {
        const presets = a.contentPresets
          ? a.contentPresets.split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
          : []
        return { type: 'require_activity', contentRequired: a.contentRequired, ...(presets.length ? { contentPresets: presets } : {}) }
      }
      if (a.type === 'ai_analysis') {
        const autoExecute = a.autoExecute
          ? a.autoExecute.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean)
          : []
        return { type: 'ai_analysis', ...(autoExecute.length ? { autoExecute } : {}) }
      }
      return a
    }),
  }
}

function formFromWorkflow(w: Workflow): WorkflowForm {
  const t = w.trigger as Record<string, unknown>
  const triggerType: WfTriggerType =
    t.type === 'on_create' ? 'on_create' :
    t.type === 'scheduled' ? 'scheduled' : 'field_change'
  const actions: WfActionForm[] = w.actions.map((a) => {
    if (a.type === 'require_activity') return { type: 'require_activity', contentRequired: a.contentRequired, contentPresets: a.contentPresets?.join(',') ?? '' }
    if (a.type === 'require_fields')   return { type: 'require_fields',   fields: a.fields as ReqField[] }
    if (a.type === 'set_field')        return { type: 'set_field',        field: (a as Record<string, string>).field ?? '', label: (a as Record<string, string>).label ?? '', value: (a as Record<string, string>).value ?? '' }
    if (a.type === 'send_email')       return { type: 'send_email',       to: (a as Record<string, string>).to ?? '', subject: (a as Record<string, string>).subject ?? '', body: (a as Record<string, string>).body ?? '' }
    if (a.type === 'ai_analysis') return { type: 'ai_analysis', autoExecute: ((a as Record<string, unknown>).autoExecute as string[] | undefined)?.join(',') ?? '' }
    return { type: 'webhook', url: (a as Record<string, string>).url ?? '', method: ((a as Record<string, string>).method ?? 'POST') as 'POST' | 'GET', body: (a as Record<string, string>).body ?? '' }
  })
  return {
    name: w.name,
    entityType: w.entityType,
    triggerType,
    triggerField: (t.field as string) ?? '',
    triggerValue: t.type === 'field_change' ? (t.to as string) ?? '' : '',
    scheduledCondition: (t.condition as ScheduledCondition) ?? 'date_is_today',
    scheduledDays: (t.days as number) ?? 7,
    actions,
  }
}

function useEntitySchema() {
  return useQuery({
    queryKey: ['entity-schema'],
    queryFn: () =>
      crmApi.get<{ data: Record<string, EntityField[]> }>('/admin/entity-schema').then((r) => r.data.data),
    staleTime: 1000 * 60 * 5,
  })
}

function SectionHeader({ step, title, desc }: { step: string; title: string; desc?: string }) {
  return (
    <div className="flex items-start gap-3 mb-3">
      <span className="flex-none w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
        {step}
      </span>
      <div>
        <p className="text-sm font-semibold text-gray-800">{title}</p>
        {desc && <p className="text-xs text-gray-400">{desc}</p>}
      </div>
    </div>
  )
}

function WorkflowFormModal({
  title, initial, onClose, onSave, saving, schema: schemaProp,
}: {
  title: string
  initial: WorkflowForm
  onClose: () => void
  onSave: (f: WorkflowForm) => void
  saving: boolean
  schema: Record<string, EntityField[]> | undefined
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<WorkflowForm>(initial)
  const set = (patch: Partial<WorkflowForm>) => setForm((f) => ({ ...f, ...patch }))
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const { data: allOptions } = useOptions()
  const { data: templates } = useQuery({
    queryKey: ['admin-action-templates'],
    queryFn: () => crmApi.get<{ data: ActionTemplate[] }>('/admin/action-templates').then((r) => r.data.data),
    staleTime: 1000 * 60 * 5,
  })
  const availableTemplates = (templates ?? []).filter(
    (t) => t.isActive && String(t.config['entityType'] ?? 'lead') === form.entityType,
  )

  const entityFields: EntityField[] = schemaProp?.[form.entityType] ?? []
  const triggerFieldDef = entityFields.find((f) => f.field === form.triggerField)
  const triggerValueOptions = triggerFieldDef?.optionGroup
    ? (allOptions?.[triggerFieldDef.optionGroup] ?? [])
    : []
  const requirableFields = entityFields.filter((f) => !f.triggerOnly)

  const handleEntityChange = (entityType: string) =>
    set({ entityType, triggerField: '', triggerValue: '', actions: [] })
  const handleTriggerTypeChange = (triggerType: WfTriggerType) =>
    set({ triggerType, triggerField: '', triggerValue: '' })
  const handleTriggerFieldChange = (field: string) =>
    set({ triggerField: field, triggerValue: '' })

  const hasAction = (type: WfActionForm['type']) => form.actions.some((a) => a.type === type)

  const addAction = (type: WfActionForm['type']) => {
    const defaults: Record<WfActionForm['type'], WfActionForm> = {
      require_activity: { type: 'require_activity', contentRequired: false, contentPresets: '' },
      require_fields:   { type: 'require_fields',   fields: [] },
      set_field:        { type: 'set_field',        field: '', label: '', value: '' },
      send_email:       { type: 'send_email',       to: '', subject: '', body: '' },
      webhook:          { type: 'webhook',          url: '', method: 'POST', body: '{}' },
      ai_analysis:      { type: 'ai_analysis',      autoExecute: '' },
    }
    set({ actions: [...form.actions, defaults[type]] })
  }

  const addFromTemplate = (t: ActionTemplate) => {
    set({ actions: [...form.actions, templateToAction(t)] })
    setShowTemplatePicker(false)
  }

  const removeAction = (idx: number) =>
    set({ actions: form.actions.filter((_, i) => i !== idx) })

  const patchAction = (idx: number, patch: object) =>
    set({ actions: form.actions.map((a, i) => i === idx ? { ...a, ...patch } as WfActionForm : a) })

  const toggleReqField = (idx: number, ef: EntityField, checked: boolean) => {
    const action = form.actions[idx]
    if (action?.type !== 'require_fields') return
    const newField: ReqField = {
      field: ef.field, label: ef.label,
      type: ef.type === 'user' ? 'text' : ef.type as ReqField['type'],
      ...(ef.optionGroup ? { optionGroup: ef.optionGroup } : {}),
    }
    const next = checked ? [...action.fields, newField] : action.fields.filter((f) => f.field !== ef.field)
    patchAction(idx, { fields: next })
  }

  const scheduledCondDef = SCHEDULED_CONDITIONS.find((c) => c.value === form.scheduledCondition)
  const dateFields = entityFields.filter((f) => f.type === 'datetime')
  const triggerReady =
    form.triggerType === 'on_create' ||
    (form.triggerType === 'field_change' && !!form.triggerField && !!form.triggerValue) ||
    (form.triggerType === 'scheduled' && (
      (!scheduledCondDef?.needsField || !!form.triggerField) &&
      (!scheduledCondDef?.needsDays  || form.scheduledDays > 0)
    ))
  const canSave = triggerReady && form.actions.length > 0

  const sel = 'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500'
  const inp = 'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500'
  const ta  = 'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none'

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={saving} disabled={!canSave} onClick={() => onSave(form)}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="space-y-4">

        {/* ① 触发器：选择事件类型 */}
        <div className="rounded-lg border border-gray-200 p-4">
          <SectionHeader step="1" title={t('settings.workflow.trigger.title')} desc={t('settings.workflow.trigger.subtitle')} />
          <div className="space-y-3 pl-9">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings.workflow.trigger.target')}</label>
              <select className={sel} value={form.entityType} onChange={(e) => handleEntityChange(e.target.value)}>
                <option value="lead">{t('settings.workflow.trigger.targets.lead')}</option>
                <option value="client">{t('settings.workflow.trigger.targets.client')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">{t('settings.workflow.trigger.type')}</label>
              <div className="grid grid-cols-3 gap-2">
                {TRIGGER_TYPE_KEYS.map((tt) => (
                  <button key={tt.type} type="button" onClick={() => handleTriggerTypeChange(tt.type)}
                    className={`rounded-md border px-3 py-2.5 text-left transition-colors ${
                      form.triggerType === tt.type ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
                    }`}>
                    <p className={`text-sm font-medium ${form.triggerType === tt.type ? 'text-primary-700' : 'text-gray-700'}`}>{t(tt.labelKey)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{t(tt.descKey)}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ② 条件：根据触发类型配置具体匹配规则 */}
        <div className="rounded-lg border border-gray-200 p-4">
          <SectionHeader step="2" title={t('settings.workflow.trigger.conditions')} desc={t('settings.workflow.trigger.conditionsHint')} />
          <div className="space-y-3 pl-9">

            {/* 新建时：无需条件 */}
            {form.triggerType === 'on_create' && (
              <p className="text-sm text-gray-400 italic">{t('settings.workflow.trigger.noCondition')}</p>
            )}

            {/* 字段变更：选字段 + 目标值 */}
            {form.triggerType === 'field_change' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings.workflow.trigger.watchField')}</label>
                  <select className={sel} value={form.triggerField} onChange={(e) => handleTriggerFieldChange(e.target.value)}>
                    <option value="">{t('settings.workflow.trigger.placeholder')}</option>
                    {entityFields.map((ef) => <option key={ef.field} value={ef.field}>{ef.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings.workflow.trigger.changeTo')}</label>
                  {triggerValueOptions.length > 0 ? (
                    <select className={sel} value={form.triggerValue} onChange={(e) => set({ triggerValue: e.target.value })}>
                      <option value="">{t('settings.workflow.trigger.placeholder')}</option>
                      <option value="*">{t('settings.workflow.trigger.anyChange')}</option>
                      {triggerValueOptions.map((o: OptionItem) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input className={inp} placeholder={t('settings.workflow.trigger.daysNoActivity')}
                      value={form.triggerValue === '*' ? '' : form.triggerValue}
                      onChange={(e) => set({ triggerValue: e.target.value || '*' })} />
                  )}
                  {form.triggerValue === '*' && (
                    <p className="text-xs text-amber-600 mt-1">{t('settings.workflow.trigger.anyChangeHint')}</p>
                  )}
                </div>
              </>
            )}

            {/* 定时触发：扫描条件 */}
            {form.triggerType === 'scheduled' && (
              <>
                <div className="rounded-md bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-700">
                  {t('settings.workflow.trigger.dailyScanHint')}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings.workflow.trigger.matchConditions')}</label>
                  <select className={sel} value={form.scheduledCondition}
                    onChange={(e) => set({ scheduledCondition: e.target.value as ScheduledCondition, triggerField: '' })}>
                    {SCHEDULED_CONDITIONS.map((c) => (
                      <option key={c.value} value={c.value}>{t(c.labelKey)}</option>
                    ))}
                  </select>
                </div>
                {scheduledCondDef?.needsField && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings.workflow.trigger.dateField')}</label>
                    <select className={sel} value={form.triggerField} onChange={(e) => set({ triggerField: e.target.value })}>
                      <option value="">{t('settings.workflow.trigger.placeholder')}</option>
                      {dateFields.map((ef) => <option key={ef.field} value={ef.field}>{ef.label}</option>)}
                    </select>
                  </div>
                )}
                {scheduledCondDef?.needsDays && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings.workflow.trigger.daysThreshold')}</label>
                    <div className="flex items-center gap-2">
                      <input type="number" min={1} max={365} className={`${inp} w-24`}
                        value={form.scheduledDays}
                        onChange={(e) => set({ scheduledDays: Math.max(1, Number(e.target.value)) })} />
                      <span className="text-sm text-gray-500">{t('settings.workflow.trigger.daysNoActivity')}</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ③ 动作 */}
        <div className="rounded-lg border border-gray-200 p-4">
          <SectionHeader step="3" title={t('settings.workflow.actions.title')} desc={t('settings.workflow.actions.subtitle')} />
          <div className="pl-9 space-y-3">
            {form.actions.length === 0 && (
              <p className="text-xs text-gray-400">{t('settings.workflow.actions.empty')}</p>
            )}

            {form.actions.map((action, idx) => (
              <div key={idx} className="rounded-md border border-gray-200 bg-gray-50">
                <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
                  <span className="text-xs font-semibold text-gray-700">{t(ACTION_LABEL_KEYS[action.type])}</span>
                  <button type="button" onClick={() => removeAction(idx)} className="text-gray-400 hover:text-red-500">
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="px-3 py-3 space-y-2">
                  <ActionConfigEditor
                    action={action}
                    onChange={(p) => patchAction(idx, p)}
                    requirableFields={requirableFields}
                    entityFields={entityFields}
                    entityType={form.entityType}
                  />
                  {!ACTION_TYPE_KEYS.find((at) => at.type === action.type)?.supported && (
                    <p className="mt-2 text-xs text-amber-500">⚠ {t('settings.workflow.actions.pending')}</p>
                  )}
                </div>
              </div>
            ))}

            {/* 从动作库添加 */}
            <div className="relative pt-1">
              {availableTemplates.length === 0 ? (
                <p className="text-xs text-gray-400 italic">
                  {t('settings.workflow.actions.noTemplates')}
                </p>
              ) : (
                <>
                  <button type="button" onClick={() => setShowTemplatePicker((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-primary-500 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-700 hover:bg-primary-100 transition-colors">
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    {t('settings.workflow.actions.addFromLib')}
                  </button>
                  {showTemplatePicker && (
                    <div className="absolute left-0 top-8 z-10 w-64 rounded-lg border border-gray-200 bg-white shadow-lg">
                      <p className="px-3 py-2 text-xs font-medium text-gray-500 border-b">{t('settings.workflow.actions.selectTemplate')}</p>
                      {availableTemplates.map((tpl) => (
                        <button key={tpl.id} type="button" onClick={() => addFromTemplate(tpl)}
                          className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors">
                          <span className="flex-1">
                            <span className="block text-sm text-gray-800">{tpl.name}</span>
                            <span className="block text-xs text-gray-400">{t(ACTION_LABEL_KEYS[tpl.type])}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 工作流名称 */}
            <div className="pt-2 border-t border-gray-100">
              <label className="block text-xs text-gray-500 mb-1">{t('settings.workflow.actions.workflowName')}</label>
              <input className={inp}
                placeholder={form.triggerType === 'on_create'
                  ? `${t(ENTITY_LABEL_KEYS[form.entityType] ?? '')} · ${t('settings.workflow.trigger.types.on_create')}`
                  : `${t(ENTITY_LABEL_KEYS[form.entityType] ?? '')} · ${form.triggerField || '?'} → ${form.triggerValue || '?'}`}
                value={form.name}
                onChange={(e) => set({ name: e.target.value })} />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ─── 动作模板 ──────────────────────────────────────────────────────────────────

interface ActionTemplate {
  id: string
  name: string
  type: WfActionForm['type']
  config: Record<string, unknown>
  isActive: number
}

function templateToAction(t: ActionTemplate): WfActionForm {
  const c = t.config
  switch (t.type) {
    case 'require_activity': return { type: 'require_activity', contentRequired: !!c['contentRequired'], contentPresets: ((c['contentPresets'] as string[] | undefined) ?? []).join(',') }
    case 'require_fields':   return { type: 'require_fields',   fields: (c['fields'] as ReqField[]) ?? [] }
    case 'set_field':        return { type: 'set_field',        field: String(c['field'] ?? ''), label: String(c['label'] ?? ''), value: String(c['value'] ?? '') }
    case 'send_email':       return { type: 'send_email',       to: String(c['to'] ?? ''), subject: String(c['subject'] ?? ''), body: String(c['body'] ?? '') }
    case 'webhook':          return { type: 'webhook',          url: String(c['url'] ?? ''), method: (String(c['method'] ?? 'POST')) as 'POST' | 'GET', body: String(c['body'] ?? '{}') }
    case 'ai_analysis':      return { type: 'ai_analysis',      autoExecute: String(c['autoExecute'] ?? '') }
    default:                 return { type: 'webhook',          url: '', method: 'POST', body: '{}' }
  }
}

function actionFormToConfig(a: WfActionForm): Record<string, unknown> {
  if (a.type === 'require_activity') {
    const presets = a.contentPresets ? a.contentPresets.split(/[,，、]/).map((s) => s.trim()).filter(Boolean) : []
    return { contentRequired: a.contentRequired, ...(presets.length ? { contentPresets: presets } : {}) }
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { type, ...rest } = a
  return rest as Record<string, unknown>
}

// ── 模板变量参考 ──────────────────────────────────────────────────────────────

const TEMPLATE_VAR_GROUPS: { labelKey: string; entityType: 'lead' | 'client' | null; varGroup: string; vars: { key: string }[] }[] = [
  {
    labelKey: 'settings.workflow.actions.sendEmail.varLead',
    entityType: 'lead',
    varGroup: 'lead',
    vars: [
      { key: 'name' }, { key: 'contactInfo' }, { key: 'source' }, { key: 'status' },
      { key: 'intendedServices' }, { key: 'lostReason' }, { key: 'nextContactDate' },
      { key: 'notes' }, { key: 'assignedToName' }, { key: 'assignedToEmail' }, { key: 'createdAt' },
    ],
  },
  {
    labelKey: 'settings.workflow.actions.sendEmail.varClient',
    entityType: 'client',
    varGroup: 'client',
    vars: [
      { key: 'name' }, { key: 'phone' }, { key: 'email' }, { key: 'contractStatus' },
      { key: 'servicePlans' }, { key: 'assignedSalesName' }, { key: 'assignedSalesEmail' }, { key: 'createdAt' },
    ],
  },
  {
    labelKey: 'settings.workflow.actions.sendEmail.varTime',
    entityType: null,
    varGroup: 'time',
    vars: [
      { key: 'now' }, { key: 'today' }, { key: 'tomorrow' }, { key: 'yesterday' },
      { key: 'weekStart' }, { key: 'weekEnd' }, { key: 'monthStart' }, { key: 'monthEnd' },
    ],
  },
]

function TemplateVarReference({ entityType }: { entityType: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const groups = TEMPLATE_VAR_GROUPS.filter(
    (g) => g.entityType === null || g.entityType === entityType,
  )
  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors">
        <svg className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        {t('settings.workflow.actions.sendEmail.variables')}
      </button>
      {open && (
        <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-3 space-y-3">
          <p className="text-xs text-gray-500">{t('settings.workflow.actions.sendEmail.variablesHint', { placeholder: '{{变量名}}', example: '{{name}}' })}</p>
          {groups.map((g) => (
            <div key={g.labelKey}>
              <p className="text-xs font-semibold text-gray-600 mb-1">{t(g.labelKey)}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
                {g.vars.map((v) => (
                  <div key={v.key} className="flex items-baseline gap-1.5 text-xs">
                    <code className="flex-none font-mono text-primary-700 bg-white border border-gray-200 rounded px-1">{`{{${v.key}}}`}</code>
                    <span className="text-gray-400">{t(`settings.workflow.actions.sendEmail.vars.${g.varGroup}.${v.key}`, v.key)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ActionConfigEditor({
  action, onChange, requirableFields, entityFields, entityType,
}: {
  action: WfActionForm
  onChange: (patch: object) => void
  requirableFields: EntityField[]
  entityFields: EntityField[]
  entityType?: string
}) {
  const { t } = useTranslation()
  const inp = 'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500'
  const sel = 'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500'
  const ta  = 'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none'

  if (action.type === 'require_activity') return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
        <input type="checkbox" className="rounded border-gray-300" checked={action.contentRequired}
          onChange={(e) => onChange({ contentRequired: e.target.checked })} />
        {t('settings.workflow.actions.requireActivity.required')}
      </label>
      <div>
        <label className="block text-xs text-gray-500 mb-1">{t('settings.workflow.actions.requireActivity.presets')}</label>
        <input className={inp} placeholder={t('settings.workflow.actions.requireActivity.presetsDefault')} value={action.contentPresets}
          onChange={(e) => onChange({ contentPresets: e.target.value })} />
      </div>
    </div>
  )

  if (action.type === 'require_fields') return (
    <div className="divide-y divide-gray-100 rounded border border-gray-200 bg-white">
      {requirableFields.length === 0
        ? <p className="px-3 py-2 text-xs text-gray-400">{t('settings.workflow.actions.requireActivity.noFields')}</p>
        : requirableFields.map((ef) => {
          const checked = action.fields.some((f) => f.field === ef.field)
          return (
            <label key={ef.field} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50">
              <input type="checkbox" className="rounded border-gray-300" checked={checked}
                onChange={(e) => {
                  const nf: ReqField = { field: ef.field, label: ef.label, type: ef.type === 'user' ? 'text' : ef.type as ReqField['type'], ...(ef.optionGroup ? { optionGroup: ef.optionGroup } : {}) }
                  const next = e.target.checked ? [...action.fields, nf] : action.fields.filter((f) => f.field !== ef.field)
                  onChange({ fields: next })
                }} />
              <span className="flex-1 text-sm text-gray-700">{ef.label}</span>
              <span className="text-xs text-gray-400">
                {ef.type === 'select' ? t('settings.workflow.actions.setField.fieldType.select') : ef.type === 'datetime' ? t('settings.workflow.actions.setField.fieldType.datetime') : ef.type === 'services' ? t('settings.workflow.actions.setField.fieldType.service') : t('settings.workflow.actions.setField.fieldType.text')}
              </span>
            </label>
          )
        })
      }
    </div>
  )

  if (action.type === 'set_field') return (
    <div className="space-y-2">
      <div>
        <label className="block text-xs text-gray-500 mb-1">{t('settings.workflow.actions.setField.targetField')}</label>
        <select className={sel} value={action.field}
          onChange={(e) => { const ef = entityFields.find((f) => f.field === e.target.value); onChange({ field: e.target.value, label: ef?.label ?? '', value: '' }) }}>
          <option value="">{t('settings.workflow.trigger.placeholder')}</option>
          {entityFields.filter((f) => !f.triggerOnly).map((ef) => <option key={ef.field} value={ef.field}>{ef.label}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">{t('settings.workflow.actions.setField.setValue')}</label>
        <input className={inp} placeholder={t('settings.workflow.trigger.placeholder')} value={action.value} onChange={(e) => onChange({ value: e.target.value })} />
      </div>
    </div>
  )

  if (action.type === 'send_email') return (
    <div className="space-y-2">
      <div><label className="block text-xs text-gray-500 mb-1">{t('settings.workflow.actions.sendEmail.to')}</label><input className={inp} placeholder="{{assignedToEmail}}" value={action.to} onChange={(e) => onChange({ to: e.target.value })} /></div>
      <div><label className="block text-xs text-gray-500 mb-1">{t('settings.workflow.actions.sendEmail.subject')}</label><input className={inp} placeholder={t('settings.workflow.actions.sendEmail.subjectDefault')} value={action.subject} onChange={(e) => onChange({ subject: e.target.value })} /></div>
      <div><label className="block text-xs text-gray-500 mb-1">{t('settings.workflow.actions.sendEmail.body')}</label><textarea className={ta} rows={4} value={action.body} onChange={(e) => onChange({ body: e.target.value })} /></div>
      <TemplateVarReference entityType={entityType ?? 'lead'} />
    </div>
  )

  if (action.type === 'webhook') return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="flex-none w-24"><label className="block text-xs text-gray-500 mb-1">{t('settings.workflow.actions.sendEmail.method')}</label>
          <select className={sel} value={action.method} onChange={(e) => onChange({ method: e.target.value })}>
            <option value="POST">POST</option><option value="GET">GET</option>
          </select></div>
        <div className="flex-1 min-w-0"><label className="block text-xs text-gray-500 mb-1">URL</label><input className={inp} placeholder="https://..." value={action.url} onChange={(e) => onChange({ url: e.target.value })} /></div>
      </div>
      <div><label className="block text-xs text-gray-500 mb-1">{t('settings.workflow.actions.sendEmail.bodyJson')}</label><textarea className={ta} rows={4} value={action.body} onChange={(e) => onChange({ body: e.target.value })} /></div>
      <TemplateVarReference entityType={entityType ?? 'lead'} />
    </div>
  )

  if (action.type === 'ai_analysis') return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">{t('settings.workflow.actions.aiAnalysis.autoActions')}</p>
      <div>
        <label className="block text-xs text-gray-500 mb-1">{t('settings.workflow.actions.aiAnalysis.autoActions')}</label>
        <input
          className={inp}
          placeholder={t('settings.workflow.actions.aiAnalysis.autoActionsDefault')}
          value={action.autoExecute}
          onChange={(e) => onChange({ autoExecute: e.target.value })}
        />
        <p className="mt-1 text-xs text-gray-400">{t('settings.workflow.actions.aiAnalysis.autoActionsHint')}</p>
      </div>
    </div>
  )

  return null
}

function ActionTemplateFormModal({
  title, initial, onClose, onSave, saving, schema: schemaProp,
}: {
  title: string
  initial: { name: string; type: WfActionForm['type']; action: WfActionForm; entityType: string }
  onClose: () => void
  onSave: (name: string, entityType: string, action: WfActionForm) => void
  saving: boolean
  schema: Record<string, EntityField[]> | undefined
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(initial.name)
  const [entityType, setEntityType] = useState(initial.entityType)
  const [action, setAction] = useState<WfActionForm>(initial.action)

  const entityFields: EntityField[] = schemaProp?.[entityType] ?? []
  const requirableFields = entityFields.filter((f) => !f.triggerOnly)

  const handleTypeChange = (type: WfActionForm['type']) => {
    const defaults: Record<WfActionForm['type'], WfActionForm> = {
      require_activity: { type: 'require_activity', contentRequired: false, contentPresets: '' },
      require_fields:   { type: 'require_fields',   fields: [] },
      set_field:        { type: 'set_field',        field: '', label: '', value: '' },
      send_email:       { type: 'send_email',       to: '', subject: '', body: '' },
      webhook:          { type: 'webhook',          url: '', method: 'POST', body: '{}' },
      ai_analysis:      { type: 'ai_analysis',      autoExecute: '' },
    }
    setAction(defaults[type])
  }

  const canSave = name.trim()

  return (
    <Modal title={title} onClose={onClose} footer={
      <><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
        <Button loading={saving} disabled={!canSave} onClick={() => onSave(name, entityType, action)}>{t('common.save')}</Button></>
    }>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.workflow.actionLib.templateName')}</label>
          <input className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
            placeholder={t('settings.workflow.actionLib.templateNamePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.workflow.actionLib.target')}</label>
          <select className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
            value={entityType} onChange={(e) => { setEntityType(e.target.value); setAction((a) => {
                      if (a.type === 'require_fields') return { type: 'require_fields', fields: [] }
                      if (a.type === 'set_field') return { type: 'set_field', field: '', label: '', value: '' }
                      return a
                    }) }}>
            <option value="lead">{t('settings.workflow.trigger.targets.lead')}</option>
            <option value="client">{t('settings.workflow.trigger.targets.client')}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.workflow.actionLib.actionType')}</label>
          <select className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
            value={action.type} onChange={(e) => handleTypeChange(e.target.value as WfActionForm['type'])}>
            {ACTION_TYPE_KEYS.map((at) => <option key={at.type} value={at.type}>{t(at.labelKey)}{!at.supported ? `（${t('settings.workflow.actionLib.pending')}）` : ''}</option>)}
          </select>
        </div>
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <ActionConfigEditor action={action} onChange={(p) => setAction((a) => ({ ...a, ...p } as WfActionForm))}
            requirableFields={requirableFields} entityFields={entityFields} entityType={entityType} />
        </div>
      </div>
    </Modal>
  )
}

function ActionTemplatesPanel({ schema }: { schema: Record<string, EntityField[]> | undefined }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [editTarget, setEditTarget] = useState<ActionTemplate | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-action-templates'],
    queryFn: () => crmApi.get<{ data: ActionTemplate[] }>('/admin/action-templates').then((r) => r.data.data),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-action-templates'] })

  const addMutation = useMutation({
    mutationFn: (body: { name: string; type: string; config: Record<string, unknown> }) =>
      crmApi.post('/admin/action-templates', body),
    onSuccess: () => { invalidate(); setShowAdd(false) },
  })

  const editMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name: string; type: string; config: Record<string, unknown> }) =>
      crmApi.put(`/admin/action-templates/${id}`, body),
    onSuccess: () => { invalidate(); setEditTarget(null) },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      crmApi.put(`/admin/action-templates/${id}`, { isActive }),
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => crmApi.delete(`/admin/action-templates/${id}`),
    onSuccess: invalidate,
  })

  const handleSave = (name: string, entityType: string, action: WfActionForm) => {
    const payload = { name, type: action.type, config: { entityType, ...actionFormToConfig(action) } }
    if (editTarget) editMutation.mutate({ id: editTarget.id, ...payload })
    else addMutation.mutate(payload)
  }

  const EMPTY_TEMPLATE = { name: '', type: 'require_activity' as WfActionForm['type'], action: { type: 'require_activity' as const, contentRequired: false, contentPresets: '' }, entityType: 'lead' }

  const templateToInitial = (t: ActionTemplate) => ({
    name: t.name,
    type: t.type,
    entityType: String(t.config['entityType'] ?? 'lead'),
    action: templateToAction(t),
  })

  if (isLoading) return <div className="py-8 text-center text-sm text-gray-400">{t('common.loading')}</div>

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500">{t('settings.workflow.actionLib.subtitle')}</p>
        <Button size="sm" onClick={() => setShowAdd(true)}>{t('settings.workflow.actionLib.new')}</Button>
      </div>

      <div className="rounded-lg border bg-white overflow-hidden">
        {(!data || data.length === 0) ? (
          <p className="py-8 text-center text-sm text-gray-400">{t('settings.workflow.actionLib.empty')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-700">{t('settings.workflow.actionLib.cols.name')}</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">{t('settings.workflow.actionLib.cols.type')}</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">{t('settings.workflow.actionLib.cols.status')}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((tpl) => (
                <tr key={tpl.id} className={tpl.isActive ? '' : 'opacity-50'}>
                  <td className="px-4 py-3 font-medium text-gray-800">{tpl.name}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{t(ACTION_LABEL_KEYS[tpl.type])}</td>
                  <td className="px-4 py-3"><Badge variant={tpl.isActive ? 'green' : 'gray'}>{tpl.isActive ? t('common.enable') : t('common.disable')}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => setEditTarget(tpl)} className="text-xs text-primary-600 hover:text-primary-800">{t('common.edit')}</button>
                      <span className="text-gray-300">|</span>
                      <button onClick={() => toggleMutation.mutate({ id: tpl.id, isActive: !tpl.isActive })} className="text-xs text-gray-500 hover:text-gray-700">{tpl.isActive ? t('common.disable') : t('common.enable')}</button>
                      <span className="text-gray-300">|</span>
                      <button onClick={() => { if (confirm(t('settings.workflow.actionLib.deleteConfirm'))) deleteMutation.mutate(tpl.id) }} className="text-xs text-red-500 hover:text-red-700">{t('common.delete')}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <ActionTemplateFormModal title={t('settings.workflow.actionLib.new')} initial={EMPTY_TEMPLATE}
          onClose={() => setShowAdd(false)} onSave={handleSave}
          saving={addMutation.isPending} schema={schema} />
      )}
      {editTarget && (
        <ActionTemplateFormModal title={t('settings.workflow.actionLib.title')} initial={templateToInitial(editTarget)}
          onClose={() => setEditTarget(null)} onSave={handleSave}
          saving={editMutation.isPending} schema={schema} />
      )}
    </div>
  )
}

// ─── 回收站面板 ───────────────────────────────────────────────────────────────

type TrashItem = {
  id: string
  name: string
  deletedAt: string
  createdAt: string
  _type: 'lead' | 'client' | 'service' | 'partner'
  [key: string]: unknown
}

const TYPE_LABEL_KEYS: Record<string, string> = {
  lead: 'settings.workflow.trigger.targets.lead',
  client: 'settings.workflow.trigger.targets.client',
  service: 'services.title',
  partner: 'partners.title',
}

function RecycleBinPanel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['recycle-bin'],
    queryFn: () => crmApi.get<{ data: TrashItem[] }>('/admin/recycle-bin').then((r) => r.data.data),
  })

  const restore = useMutation({
    mutationFn: ({ type, id }: { type: string; id: string }) =>
      crmApi.post(`/admin/recycle-bin/${type}/${id}/restore`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recycle-bin'] }),
  })

  const purge = useMutation({
    mutationFn: ({ type, id }: { type: string; id: string }) =>
      crmApi.delete(`/admin/recycle-bin/${type}/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['recycle-bin'] }),
  })

  const items = data ?? []

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-white overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
          <div>
            <h2 className="font-semibold text-gray-800 text-sm">{t('settings.trash.title')}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{t('settings.trash.subtitle')}</p>
          </div>
          <span className="text-xs text-gray-400">{items.length} {t('settings.trash.count')}</span>
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-sm text-gray-400">{t('common.loading')}</div>
        ) : items.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">{t('settings.trash.empty')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-700">{t('settings.trash.cols.type')}</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">{t('settings.trash.cols.name')}</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 hidden sm:table-cell">{t('settings.trash.cols.extra')}</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 hidden sm:table-cell">{t('settings.trash.cols.deletedAt')}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => {
                const sub =
                  item._type === 'lead'    ? `${item.source ?? ''} · ${item.contactInfo ?? ''}` :
                  item._type === 'client'  ? `${item.phone ?? ''} ${item.email ?? ''}`.trim() :
                  item._type === 'service' ? (item.description as string ?? '') :
                  item._type === 'partner' ? `${item.type ?? ''} · ${item.contactPerson ?? ''}` : ''
                return (
                  <tr key={`${item._type}-${item.id}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-600">
                        {t(TYPE_LABEL_KEYS[item._type] ?? item._type)}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs hidden sm:table-cell max-w-[200px] truncate">{sub || '—'}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs hidden sm:table-cell">
                      {item.deletedAt ? new Date(item.deletedAt).toLocaleString('zh-CN') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => restore.mutate({ type: item._type, id: item.id })}
                          className="text-xs text-primary-600 hover:text-primary-800 font-medium"
                        >
                          {t('common.restore')}
                        </button>
                        <span className="text-gray-300">|</span>
                        <button
                          onClick={() => {
                            if (confirm(t('settings.trash.hardDeleteConfirm', { name: item.name })))
                              purge.mutate({ type: item._type, id: item.id })
                          }}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          {t('settings.trash.hardDelete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function WorkflowsPanel({ autoAssignEnabled, onSettingsSaved }: { autoAssignEnabled: boolean; onSettingsSaved: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [subTab, setSubTab] = useState<'workflows' | 'assignment'>('workflows')
  const [showAdd, setShowAdd] = useState(false)
  const [editTarget, setEditTarget] = useState<Workflow | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-workflows'],
    queryFn: () =>
      crmApi.get<{ data: Workflow[] }>('/admin/workflows').then((r) => r.data.data),
  })

  const { data: schema } = useEntitySchema()

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-workflows'] })
    queryClient.invalidateQueries({ queryKey: ['workflows'] })
  }

  // 自动分配
  const { data: rules, isLoading: rulesLoading } = useQuery({
    queryKey: ['assignment-rules'],
    queryFn: () =>
      crmApi.get<{ data: AssignmentRule[] }>('/admin/assignment-rules').then((r) => r.data.data),
    enabled: subTab === 'assignment',
  })

  const updateRule = useMutation({
    mutationFn: ({ id, ...body }: { id: string; isActive?: boolean; priority?: number }) =>
      crmApi.put(`/admin/assignment-rules/${id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['assignment-rules'] }),
  })

  const toggleAutoAssign = useMutation({
    mutationFn: (enabled: boolean) =>
      crmApi.put('/admin/settings', { auto_assign_enabled: enabled ? 'true' : 'false' }),
    onSuccess: onSettingsSaved,
  })

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      crmApi.put(`/admin/workflows/${id}`, { isActive }),
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => crmApi.delete(`/admin/workflows/${id}`),
    onSuccess: invalidate,
  })

  const addMutation = useMutation({
    mutationFn: (f: WorkflowForm) => crmApi.post('/admin/workflows', buildWorkflowPayload(f)),
    onSuccess: () => { invalidate(); setShowAdd(false) },
  })

  const editMutation = useMutation({
    mutationFn: ({ id, f }: { id: string; f: WorkflowForm }) =>
      crmApi.put(`/admin/workflows/${id}`, buildWorkflowPayload(f)),
    onSuccess: () => { invalidate(); setEditTarget(null) },
  })

  const formatActions = (w: Workflow) => {
    const parts: string[] = []
    for (const a of w.actions) {
      if (a.type === 'require_activity') {
        parts.push(t('settings.workflow.actions.types.require_activity'))
        if (a.contentRequired) parts.push(t('settings.workflow.actions.requireActivity.required'))
        if (a.contentPresets?.length) parts.push(`${a.contentPresets.join(' / ')}`)
      } else if (a.type === 'require_fields') {
        parts.push(a.fields.map((f) => f.label).join(' / '))
      }
    }
    return parts.join('；') || '—'
  }

  const triggerLabel = (w: Workflow) => {
    if (w.trigger.type === 'on_create') return t('settings.workflow.trigger.types.on_create')
    const tr = w.trigger as { type: 'field_change'; field: string; to: string }
    const fieldLabel = schema?.[w.entityType]?.find((f) => f.field === tr.field)?.label ?? tr.field
    return `${fieldLabel} → ${tr.to}`
  }

  return (
    <div>
      {/* 子 Tab */}
      <div className="flex gap-1 mb-4 border-b border-gray-200 overflow-x-auto overflow-y-hidden scrollbar-none">
        {([['workflows', t('settings.workflow.title')], ['assignment', t('settings.workflow.autoAssign.title')]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setSubTab(key)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              subTab === key ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* 自动分配子 Tab */}
      {subTab === 'assignment' && (
        <div className="max-w-2xl space-y-4">
          <div className="rounded-lg border bg-white p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">{t('settings.workflow.autoAssign.toggle')}</p>
                <p className="mt-0.5 text-xs text-gray-500">{t('settings.workflow.autoAssign.toggleHint')}</p>
              </div>
              <button
                type="button"
                onClick={() => toggleAutoAssign.mutate(!autoAssignEnabled)}
                disabled={toggleAutoAssign.isPending}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  autoAssignEnabled ? 'bg-primary-600' : 'bg-gray-200'
                }`}
              >
                <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform duration-200 ease-in-out ${
                  autoAssignEnabled ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </button>
            </div>
          </div>

          <div className="rounded-lg border bg-white overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50">
              <p className="text-sm font-medium text-gray-700">{t('settings.workflow.autoAssign.rules')}</p>
              <p className="mt-0.5 text-xs text-gray-500">{t('settings.workflow.autoAssign.rulesHint')}</p>
            </div>
            {rulesLoading ? (
              <div className="py-8 text-center text-sm text-gray-400">{t('common.loading')}</div>
            ) : !rules?.length ? (
              <div className="py-8 text-center text-sm text-gray-400">{t('settings.workflow.autoAssign.empty')}</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-700 w-8">{t('settings.workflow.autoAssign.cols.priority')}</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">{t('settings.workflow.autoAssign.cols.name')}</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-700">{t('settings.workflow.autoAssign.cols.desc')}</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-700">{t('common.enable')}</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-700">{t('settings.workflow.autoAssign.reorder')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[...rules].sort((a, b) => a.priority - b.priority).map((rule, idx, arr) => (
                    <tr key={rule.id} className={rule.isActive ? '' : 'opacity-50'}>
                      <td className="px-4 py-3 text-center text-gray-400 text-xs">{rule.priority}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{rule.ruleTypeLabel}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{RULE_DESCRIPTION_KEYS[rule.ruleType] ? t(RULE_DESCRIPTION_KEYS[rule.ruleType]!) : '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <button type="button"
                          onClick={() => updateRule.mutate({ id: rule.id, isActive: rule.isActive === 0 })}
                          className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${rule.isActive ? 'bg-primary-600' : 'bg-gray-200'}`}>
                          <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${rule.isActive ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button type="button" disabled={idx === 0}
                            onClick={() => { const prev = arr[idx - 1]!; updateRule.mutate({ id: rule.id, priority: prev.priority }); updateRule.mutate({ id: prev.id, priority: rule.priority }) }}
                            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed" title={t('settings.workflow.autoAssign.moveUp')}>↑</button>
                          <button type="button" disabled={idx === arr.length - 1}
                            onClick={() => { const next = arr[idx + 1]!; updateRule.mutate({ id: rule.id, priority: next.priority }); updateRule.mutate({ id: next.id, priority: rule.priority }) }}
                            className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed" title={t('settings.workflow.autoAssign.moveDown')}>↓</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* 工作流子 Tab */}
      {subTab === 'workflows' && <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500">{t('settings.workflow.subtitle')}</p>
        <Button size="sm" onClick={() => navigate('/app/settings/workflows/new')}>{t('settings.workflow.new')}</Button>
      </div>

      <div className="rounded-lg border bg-white overflow-hidden">
        {(!data || data.length === 0) ? (
          <p className="py-8 text-center text-sm text-gray-400">{t('settings.workflow.empty')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-700">{t('settings.workflow.cols.target')}</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">{t('settings.workflow.cols.trigger')}</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">{t('settings.workflow.cols.actions')}</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">{t('settings.workflow.cols.status')}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((w) => (
                <tr key={w.id} className={w.isActive ? '' : 'opacity-50'}>
                  <td className="px-4 py-3 text-gray-700">{t(ENTITY_LABEL_KEYS[w.entityType] ?? '') || w.entityType}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{triggerLabel(w)}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs max-w-xs">{formatActions(w)}</td>
                  <td className="px-4 py-3">
                    <Badge variant={w.isActive ? 'green' : 'gray'}>
                      {w.isActive ? t('common.enable') : t('common.disable')}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => navigate(`/app/settings/workflows/${w.id}`)}
                        className="text-xs text-primary-600 hover:text-primary-800"
                      >
                        {t('common.edit')}
                      </button>
                      <span className="text-gray-300">|</span>
                      <button
                        onClick={() => toggle.mutate({ id: w.id, isActive: !w.isActive })}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        {w.isActive ? t('common.disable') : t('common.enable')}
                      </button>
                      <span className="text-gray-300">|</span>
                      <button
                        onClick={() => { if (confirm(t('settings.workflow.deleteConfirm'))) deleteMutation.mutate(w.id) }}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <WorkflowFormModal
          title={t('settings.workflow.new')}
          initial={EMPTY_WORKFLOW}
          onClose={() => setShowAdd(false)}
          onSave={(f) => addMutation.mutate(f)}
          saving={addMutation.isPending}
          schema={schema}
        />
      )}

      {editTarget && (
        <WorkflowFormModal
          title={t('settings.workflow.title')}
          initial={formFromWorkflow(editTarget)}
          onClose={() => setEditTarget(null)}
          onSave={(f) => editMutation.mutate({ id: editTarget.id, f })}
          saving={editMutation.isPending}
          schema={schema}
        />
      )}
      </>}
    </div>
  )
}

const EMPTY_FIELD = (): ActivityMetaField => ({ key: '', label: '', type: 'text', unit: '' })

function OptionGroupPanel({ groupKey, noAdd }: { groupKey: string; noAdd: boolean }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editTarget, setEditTarget] = useState<OptionItem | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [editColor, setEditColor] = useState<Color>('gray')
  const [addColor, setAddColor] = useState<Color>('gray')
  const [editFields, setEditFields] = useState<ActivityMetaField[]>([])
  const [editMilestoneMapping, setEditMilestoneMapping] = useState<MilestoneMapping | null>(null)
  const isActivityType = groupKey === 'activity_type'

  const { data, isLoading } = useQuery({
    queryKey: ['admin-options', groupKey],
    queryFn: () =>
      crmApi.get<{ data: OptionItem[] }>('/admin/options/items', { params: { groupKey } })
        .then((r) => r.data.data),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-options', groupKey] })
    queryClient.invalidateQueries({ queryKey: ['options'] })
  }

  const editForm = useForm<OptionItemForm>({ resolver: zodResolver(optionItemSchema) })
  const addForm  = useForm<OptionItemForm>({ resolver: zodResolver(optionItemSchema), defaultValues: { color: 'gray' } })

  const updateMutation = useMutation({
    mutationFn: ({ id, metadata, ...body }: { id: string; metadata?: string } & OptionItemForm) =>
      crmApi.put(`/admin/options/items/${id}`, metadata !== undefined ? { ...body, metadata } : body),
    onSuccess: () => { setEditTarget(null); invalidate() },
  })

  const addMutation = useMutation({
    mutationFn: (body: OptionItemForm) =>
      crmApi.post('/admin/options/items', { ...body, groupKey }),
    onSuccess: () => { setShowAdd(false); addForm.reset(); setAddColor('gray'); invalidate() },
  })

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      crmApi.put(`/admin/options/items/${id}`, { isActive }),
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => crmApi.delete(`/admin/options/items/${id}`),
    onSuccess: invalidate,
  })

  const scopeMutation = useMutation({
    mutationFn: ({ id, meta }: { id: string; meta: ActivityMeta }) =>
      crmApi.put(`/admin/options/items/${id}`, { metadata: JSON.stringify(meta) }),
    onSuccess: invalidate,
  })

  const toggleScope = (item: OptionItem, s: 'lead' | 'client') => {
    const meta = parseActivityMeta(item)
    const scope = meta.scope ?? []
    const newScope = scope.includes(s) ? scope.filter((x) => x !== s) : [...scope, s]
    scopeMutation.mutate({ id: item.id, meta: { ...meta, scope: newScope } })
  }

  const openEdit = (item: OptionItem) => {
    setEditTarget(item)
    setEditColor(item.color)
    editForm.reset({ value: item.value, label: item.label, color: item.color })
    if (isActivityType) {
      const meta = parseActivityMeta(item)
      setEditFields(meta.fields ?? [])
      setEditMilestoneMapping(meta.milestoneMapping ?? null)
    }
  }

  const updateField = (idx: number, patch: Partial<ActivityMetaField>) => {
    setEditFields((prev) => prev.map((f, i) => i === idx ? { ...f, ...patch } : f))
  }

  const handleSave = editForm.handleSubmit((d) => {
    if (isActivityType) {
      const existingMeta = parseActivityMeta(editTarget!)
      const fields = editFields.filter((f) => f.key.trim() && f.label.trim())
      const metadata = JSON.stringify({ ...existingMeta, fields, milestoneMapping: editMilestoneMapping })
      updateMutation.mutate({ id: editTarget!.id, ...d, color: editColor, metadata })
    } else {
      updateMutation.mutate({ id: editTarget!.id, ...d, color: editColor })
    }
  })

  if (isLoading) return <div className="py-8 text-center text-sm text-gray-400">{t('common.loading')}</div>

  return (
    <div>
      {/* 移动端：卡片列表 */}
      <div className="sm:hidden space-y-2">
        {data?.map((item) => {
          const meta = isActivityType ? parseActivityMeta(item) : null
          const scope = meta?.scope ?? []
          const fieldCount = meta?.fields?.filter((f) => f.key && f.label).length ?? 0
          return (
            <div key={item.id} className={`rounded-lg border bg-white p-3 ${item.isActive ? '' : 'opacity-50'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`flex-shrink-0 inline-block w-3 h-3 rounded-full ${COLOR_CLASS[item.color] ?? 'bg-gray-200'}`} />
                  <span className="font-medium text-gray-900 truncate">{item.label}</span>
                  <span className="text-gray-400 font-mono text-xs flex-shrink-0">{item.value}</span>
                </div>
                <Badge variant={item.isActive ? 'green' : 'gray'} className="flex-shrink-0">
                  {item.isActive ? t('common.enable') : t('common.disable')}
                </Badge>
              </div>

              {isActivityType && (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-400">{t('settings.options.scope')}</span>
                  {(['lead', 'client'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleScope(item, s)}
                      className={`rounded px-2 py-0.5 text-xs font-medium border transition-colors ${
                        scope.length === 0 || scope.includes(s)
                          ? 'bg-primary-50 border-primary-300 text-primary-700'
                          : 'bg-gray-50 border-gray-200 text-gray-400'
                      }`}
                    >
                      {s === 'lead' ? t('settings.workflow.trigger.targets.lead') : t('settings.workflow.trigger.targets.client')}
                    </button>
                  ))}
                  {fieldCount > 0 && (
                    <span className="text-xs text-gray-400 ml-auto">{fieldCount} {t('settings.options.customFieldCount')}</span>
                  )}
                </div>
              )}

              <div className="mt-2 flex items-center gap-3 border-t pt-2">
                <button onClick={() => openEdit(item)} className="text-xs text-primary-600 font-medium">{t('common.edit')}</button>
                {!item.isSystem && (
                  <>
                    <button
                      onClick={() => toggleActive.mutate({ id: item.id, isActive: !item.isActive })}
                      className="text-xs text-gray-500"
                    >
                      {item.isActive ? t('common.disable') : t('common.enable')}
                    </button>
                    <button
                      onClick={() => { if (confirm(t('settings.options.deleteConfirm', { name: item.label }))) deleteMutation.mutate(item.id) }}
                      className="text-xs text-red-500 ml-auto"
                    >
                      {t('common.delete')}
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 桌面端：表格 */}
      <div className="hidden sm:block rounded-lg border bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-700 w-8">{t('settings.options.cols.color')}</th>
              <th className="px-4 py-3 text-left font-medium text-gray-700">{t('settings.options.cols.value')}</th>
              <th className="px-4 py-3 text-left font-medium text-gray-700">{t('settings.options.cols.label')}</th>
              {isActivityType && (
                <th className="px-4 py-3 text-left font-medium text-gray-700">{t('settings.options.cols.scope')}</th>
              )}
              <th className="px-4 py-3 text-left font-medium text-gray-700">{t('settings.options.cols.status')}</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data?.map((item) => {
              const meta = isActivityType ? parseActivityMeta(item) : null
              const scope = meta?.scope ?? []
              return (
              <tr key={item.id} className={item.isActive ? '' : 'opacity-50'}>
                <td className="px-4 py-3">
                  <span className={`inline-block w-4 h-4 rounded-full ${COLOR_CLASS[item.color] ?? 'bg-gray-200'}`} />
                </td>
                <td className="px-4 py-3 text-gray-500 font-mono text-xs">{item.value}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{item.label}</td>
                {isActivityType && (
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {(['lead', 'client'] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => toggleScope(item, s)}
                          className={`rounded px-2 py-0.5 text-xs font-medium border transition-colors ${
                            scope.length === 0 || scope.includes(s)
                              ? 'bg-primary-50 border-primary-300 text-primary-700'
                              : 'bg-gray-50 border-gray-200 text-gray-400'
                          }`}
                        >
                          {s === 'lead' ? t('settings.workflow.trigger.targets.lead') : t('settings.workflow.trigger.targets.client')}
                        </button>
                      ))}
                    </div>
                  </td>
                )}
                <td className="px-4 py-3">
                  <Badge variant={item.isActive ? 'green' : 'gray'}>
                    {item.isActive ? t('common.enable') : t('common.disable')}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 justify-end">
                    <button onClick={() => openEdit(item)} className="text-xs text-primary-600 hover:text-primary-800">{t('common.edit')}</button>
                    {!item.isSystem && (
                      <>
                        <span className="text-gray-300">|</span>
                        <button
                          onClick={() => toggleActive.mutate({ id: item.id, isActive: !item.isActive })}
                          className="text-xs text-gray-500 hover:text-gray-700"
                        >
                          {item.isActive ? t('common.disable') : t('common.enable')}
                        </button>
                        <span className="text-gray-300">|</span>
                        <button
                          onClick={() => { if (confirm(t('settings.options.deleteConfirm', { name: item.label }))) deleteMutation.mutate(item.id) }}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          {t('common.delete')}
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!noAdd && (
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={() => setShowAdd(true)}>
            {t('settings.options.addOption')}
          </Button>
        </div>
      )}

      {editTarget && (
        <Modal
          title={t('settings.options.editOption', { name: editTarget.label })}
          onClose={() => setEditTarget(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditTarget(null)}>{t('common.cancel')}</Button>
              <Button loading={updateMutation.isPending} onClick={handleSave}>{t('common.save')}</Button>
            </>
          }
        >
          <div className="space-y-3">
            {editTarget.isSystem ? (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">{t('settings.options.valueFixed')}</p>
                <p className="rounded-md bg-gray-100 px-3 py-2 text-sm text-gray-500 font-mono">{editTarget.value}</p>
              </div>
            ) : (
              <Input label={t('settings.options.valueLabel')} error={editForm.formState.errors.value?.message} {...editForm.register('value')} />
            )}
            <Input label={t('settings.options.labelLabel')} error={editForm.formState.errors.label?.message} {...editForm.register('label')} />
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">{t('settings.options.colorLabel')}</p>
              <ColorPicker value={editColor} onChange={setEditColor} />
            </div>

            {isActivityType && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-gray-700">{t('settings.options.customFields')}</p>
                  <button
                    type="button"
                    onClick={() => setEditFields((prev) => [...prev, EMPTY_FIELD()])}
                    className="text-xs text-primary-600 hover:text-primary-800"
                  >
                    {t('settings.options.addField')}
                  </button>
                </div>
                {editFields.length === 0 ? (
                  <p className="text-xs text-gray-400 py-2">{t('settings.options.noCustomFields')}</p>
                ) : (
                  <div className="space-y-2">
                    {editFields.map((f, idx) => (
                      <div key={idx} className="space-y-1">
                        <div className="grid grid-cols-12 gap-1.5 items-center">
                          <input
                            placeholder={t('settings.options.fieldKey')}
                            value={f.key}
                            onChange={(e) => updateField(idx, { key: e.target.value })}
                            className="col-span-3 rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary-500"
                          />
                          <input
                            placeholder={t('settings.options.fieldLabel')}
                            value={f.label}
                            onChange={(e) => updateField(idx, { label: e.target.value })}
                            className="col-span-3 rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary-500"
                          />
                          <select
                            value={f.type}
                            onChange={(e) => updateField(idx, { type: e.target.value as ActivityMetaField['type'], options: [], unit: '' })}
                            className="col-span-2 rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary-500"
                          >
                            <option value="text">{t('settings.options.types.text')}</option>
                            <option value="number">{t('settings.options.types.number')}</option>
                            <option value="date">{t('settings.options.types.date')}</option>
                            <option value="select">{t('settings.options.types.select')}</option>
                            <option value="product_select">{t('settings.options.types.product_select')}</option>
                          </select>
                          {f.type === 'number' ? (
                            <input
                              placeholder={t('settings.options.fieldUnit')}
                              value={f.unit ?? ''}
                              onChange={(e) => updateField(idx, { unit: e.target.value })}
                              className="col-span-3 rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary-500"
                            />
                          ) : (
                            <div className="col-span-3" />
                          )}
                          <button
                            type="button"
                            onClick={() => setEditFields((prev) => prev.filter((_, i) => i !== idx))}
                            className="col-span-1 text-gray-400 hover:text-red-500 text-sm text-center"
                          >
                            ×
                          </button>
                        </div>
                        {f.type === 'select' && (
                          <div className="ml-1 pl-2 border-l border-gray-200">
                            <p className="text-xs text-gray-400 mb-1">{t('settings.options.fieldOptions')}</p>
                            <textarea
                              rows={3}
                              placeholder={"A\nB\nC"}
                              className="w-full rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none"
                              value={(f.options ?? []).join('\n')}
                              onChange={(e) => updateField(idx, { options: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                    <p className="text-xs text-gray-400">{t('settings.options.fieldHint')}</p>
                  </div>
                )}
              </div>
            )}

            {isActivityType && (
              <div className="border-t pt-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-gray-700">{t('settings.options.milestoneMapping')}</p>
                  <button
                    type="button"
                    onClick={() => setEditMilestoneMapping(editMilestoneMapping ? null : { action: 'complete', advanceNext: true })}
                    className="text-xs text-primary-600 hover:text-primary-800"
                  >
                    {editMilestoneMapping ? t('common.remove') : t('common.add')}
                  </button>
                </div>
                {editMilestoneMapping ? (
                  <div className="space-y-2 rounded-lg bg-amber-50 border border-amber-200 p-3">
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-gray-500">{t('settings.options.milestoneStepName')}</label>
                      <input
                        placeholder={t('settings.options.milestoneStepNameHint')}
                        value={editMilestoneMapping.stepName ?? ''}
                        onChange={(e) => { if (editMilestoneMapping) setEditMilestoneMapping({ action: editMilestoneMapping.action, advanceNext: editMilestoneMapping.advanceNext, ...(e.target.value ? { stepName: e.target.value } : {}) } as MilestoneMapping) }}
                        className="rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary-500"
                      />
                    </div>
                    <div className="flex gap-3">
                      <div className="flex flex-col gap-1 flex-1">
                        <label className="text-xs text-gray-500">{t('settings.options.milestoneAction')}</label>
                        <select
                          value={editMilestoneMapping.action}
                          onChange={(e) => { if (editMilestoneMapping) setEditMilestoneMapping({ ...editMilestoneMapping, action: e.target.value as 'in_progress' | 'complete' }) }}
                          className="rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary-500"
                        >
                          <option value="in_progress">{t('settings.options.milestoneActionStart')}</option>
                          <option value="complete">{t('settings.options.milestoneActionComplete')}</option>
                        </select>
                      </div>
                      {editMilestoneMapping.action === 'complete' && (
                        <div className="flex items-end pb-1">
                          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editMilestoneMapping.advanceNext !== false}
                              onChange={(e) => { if (editMilestoneMapping) setEditMilestoneMapping({ ...editMilestoneMapping, advanceNext: e.target.checked }) }}
                              className="rounded"
                            />
                            {t('settings.options.milestoneAdvanceNext')}
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">{t('settings.options.milestoneNoMapping')}</p>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {showAdd && (
        <Modal
          title={t('settings.options.addOptionTitle')}
          onClose={() => { setShowAdd(false); addForm.reset(); setAddColor('gray') }}
          footer={
            <>
              <Button variant="secondary" onClick={() => { setShowAdd(false); addForm.reset(); setAddColor('gray') }}>{t('common.cancel')}</Button>
              <Button
                loading={addMutation.isPending}
                onClick={addForm.handleSubmit((d) => addMutation.mutate({ ...d, color: addColor }))}
              >
                {t('common.add')}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Input label={t('settings.options.optionValue')} placeholder={t('settings.options.optionValuePlaceholder')} error={addForm.formState.errors.value?.message} {...addForm.register('value')} />
            <Input label={t('settings.options.optionLabel')} placeholder={t('settings.options.optionLabelPlaceholder')} error={addForm.formState.errors.label?.message} {...addForm.register('label')} />
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">{t('settings.options.optionColor')}</p>
              <ColorPicker value={addColor} onChange={setAddColor} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

interface AiProvider {
  id: string
  name: string
  providerType: 'openai' | 'anthropic' | 'custom' | 'cloudflare'
  apiKeyMasked: string
  baseUrl: string | null
  isActive: number
}

interface AiModel {
  id: string
  providerId: string
  providerName: string
  providerType: string
  modelId: string
  displayName: string
  isEnabled: number
}

interface AssignmentRule {
  id: string
  ruleType: string
  ruleTypeLabel: string
  priority: number
  configJson: string
  isActive: number
}

const RULE_DESCRIPTION_KEYS: Record<string, string> = {
  round_robin:  'settings.workflow.autoAssign.strategies.roundRobin',
  load_balance: 'settings.workflow.autoAssign.strategies.leastLeads',
  skill_match:  'settings.workflow.autoAssign.strategies.serviceMatch',
  region_match: 'settings.workflow.autoAssign.strategies.regionMatch',
}

const COMMON_TIMEZONE_VALUES = [
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Taipei',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'UTC',
]

// ─────────────────────────────────────────────────────────────────────────────

const schema = z.object({
  system_name: z.string().min(1),
  timezone:    z.string(),
  // 业务背景：供 AI 分析、AI 助手、MCP 了解业务（行业模板初始化时写入）
  industry_context: z.string().max(2000).optional(),
})
type SettingsForm = z.infer<typeof schema>

type Settings = Record<string, string>

const TAB_KEYS = [
  { key: 'basic',      labelKey: 'settings.tabs.basic' },
  { key: 'options',    labelKey: 'settings.tabs.options' },
  { key: 'automation', labelKey: 'settings.tabs.automation' },
  { key: 'trash',      labelKey: 'settings.tabs.trash' },
] as const
type TabKey = typeof TAB_KEYS[number]['key']
// 旧链接兼容：AI 配置与工作流合并为「AI 与自动化」
const TAB_ALIASES: Record<string, TabKey> = { ai: 'automation', policies: 'automation' }

const teamSchema = z.object({
  name:   z.string().min(1),
  region: z.string().optional(),
})
type TeamForm = z.infer<typeof teamSchema>

export default function SystemSettingsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const [saved, setSaved] = useState(false)
  const OPTION_GROUPS = OPTION_GROUPS_KEYS.map((g) => ({ ...g, label: t(g.labelKey) }))
  const TABS = TAB_KEYS.map((tab) => ({ ...tab, label: t(tab.labelKey) }))
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const raw = searchParams.get('tab') ?? ''
    const tab = TAB_ALIASES[raw] ?? raw
    return (TAB_KEYS.some((t) => t.key === tab) ? tab : 'basic') as TabKey
  })
  const [editTarget, setEditTarget] = useState<Team | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [activeGroup, setActiveGroup] = useState(OPTION_GROUPS_KEYS[0]!.key)

  // AI 配置相关 state
  const [showAddProvider, setShowAddProvider] = useState(false)
  const [aiProviderForm, setAiProviderForm] = useState({ name: '', providerType: 'openai', apiKey: '', baseUrl: '' })
  const [availableModels, setAvailableModels] = useState<{ id: string; name: string }[] | null>(null)
  const [loadingModelsFor, setLoadingModelsFor] = useState<string | null>(null)
  const [modelsProviderId, setModelsProviderId] = useState<string | null>(null)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [manualModel, setManualModel] = useState({ modelId: '', displayName: '' })
  const [testModelId, setTestModelId] = useState<string | null>(null)
  const [testPrompt, setTestPrompt] = useState('')
  const [testResult, setTestResult] = useState<{ reply: string; latencyMs: number } | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [testLoading, setTestLoading] = useState(false)

  const runTest = async (modelId: string) => {
    setTestLoading(true)
    setTestResult(null)
    setTestError(null)
    try {
      const res = await crmApi.post<{ data: { reply: string; latencyMs: number } }>(
        `/admin/ai/models/${modelId}/test`,
        { prompt: testPrompt },
      )
      setTestResult(res.data.data)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('settings.ai.testFailed')
      setTestError(msg)
    } finally {
      setTestLoading(false)
    }
  }

  // 团队列表
  const { data: teams, isLoading: teamsLoading } = useQuery({
    queryKey: ['teams'],
    queryFn: () => crmApi.get<{ data: Team[] }>('/teams').then((r) => r.data.data),
    enabled: activeTab === 'options' && activeGroup === 'teams',
  })

  // AI 提供商 & 模型
  const { data: aiProvidersData, refetch: refetchProviders } = useQuery({
    queryKey: ['ai-providers'],
    queryFn: () => crmApi.get<{ data: AiProvider[] }>('/admin/ai/providers').then((r) => r.data.data),
    enabled: activeTab === 'automation',
  })
  const aiProviders = aiProvidersData ?? []

  const { data: aiModelsData, refetch: refetchModels } = useQuery({
    queryKey: ['ai-models'],
    queryFn: () => crmApi.get<{ data: AiModel[] }>('/admin/ai/models').then((r) => r.data.data),
    enabled: activeTab === 'automation',
  })
  const aiModels = aiModelsData ?? []

  const addProvider = useMutation({
    mutationFn: (body: typeof aiProviderForm) => crmApi.post('/admin/ai/providers', body),
    onSuccess: () => { setShowAddProvider(false); setAiProviderForm({ name: '', providerType: 'openai', apiKey: '', baseUrl: '' }); refetchProviders() },
  })

  const deleteProvider = useMutation({
    mutationFn: (id: string) => crmApi.delete(`/admin/ai/providers/${id}`),
    onSuccess: () => { refetchProviders(); refetchModels() },
  })

  const enableModel = useMutation({
    mutationFn: (body: { providerId: string; modelId: string; displayName: string }) =>
      crmApi.post('/admin/ai/models', body),
    onSuccess: () => refetchModels(),
  })

  const removeModel = useMutation({
    mutationFn: (id: string) => crmApi.delete(`/admin/ai/models/${id}`),
    onSuccess: () => refetchModels(),
  })

  const fetchAvailableModels = async (providerId: string) => {
    setLoadingModelsFor(providerId)
    setModelsProviderId(providerId)
    setAvailableModels(null)
    setModelsError(null)
    try {
      const res = await crmApi.get<{ data: { id: string; name: string }[] }>(
        `/admin/ai/providers/${providerId}/available-models`,
      )
      setAvailableModels(res.data.data)
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('settings.ai.queryFailed')
      setModelsError(msg)
    } finally {
      setLoadingModelsFor(null)
    }
  }

  const teamForm = useForm<TeamForm>({ resolver: zodResolver(teamSchema) })
  const addForm  = useForm<TeamForm>({ resolver: zodResolver(teamSchema) })

  const invalidateTeams = () => queryClient.invalidateQueries({ queryKey: ['teams'] })

  const updateTeam = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & TeamForm) =>
      crmApi.put(`/teams/${id}`, body),
    onSuccess: () => { setEditTarget(null); invalidateTeams() },
  })

  const addTeam = useMutation({
    mutationFn: (body: TeamForm) => crmApi.post('/teams', body),
    onSuccess: () => { setShowAdd(false); addForm.reset(); invalidateTeams() },
  })

  const deleteTeam = useMutation({
    mutationFn: (id: string) => crmApi.delete(`/teams/${id}`),
    onSuccess: invalidateTeams,
  })

  const openEdit = (team: Team) => {
    setEditTarget(team)
    teamForm.reset({ name: team.name, region: team.region ?? '' })
  }


  const { data, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => crmApi.get<{ data: Settings }>('/admin/settings').then((r) => r.data.data),
  })

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<SettingsForm>({
    resolver: zodResolver(schema),
    defaultValues: { system_name: '', timezone: 'Asia/Shanghai' },
  })

  useEffect(() => {
    if (data) reset(data as SettingsForm)
  }, [data, reset])

  const saveMutation = useMutation({
    mutationFn: (body: SettingsForm) => crmApi.put('/admin/settings', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-settings'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  if (isLoading) return <div className="p-6 text-sm text-gray-500">{t('common.loading')}</div>

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-lg sm:text-xl font-semibold text-gray-900">{t('settings.title')}</h1>
        <p className="mt-0.5 text-sm text-gray-500">{t('settings.subtitle')}</p>
      </div>

      {/* Tab 切换 */}
      <div className="mb-4 flex gap-1 border-b overflow-x-auto overflow-y-hidden scrollbar-none">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab.key
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <form id="basic-settings-form" onSubmit={handleSubmit((d) => saveMutation.mutate(d))}>
        <div className="max-w-2xl">
          {activeTab === 'basic' && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-white p-4 sm:p-6">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">{t('settings.basic.title')}</h2>
                <div className="space-y-3">
                  <Input
                    label={t('settings.basic.systemName')}
                    error={errors.system_name?.message}
                    {...register('system_name')}
                  />
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.basic.timezone')}</label>
                    <select
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                      {...register('timezone')}
                    >
                      {COMMON_TIMEZONE_VALUES.map((tzValue) => (
                        <option key={tzValue} value={tzValue}>{t(`settings.timezones.${tzValue}`, tzValue)}</option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-gray-400">{t('settings.basic.timezoneHint')}</p>
                  </div>
                  <div>
                    <Textarea
                      id="industry-context"
                      label={t('settings.basic.industryContext')}
                      rows={3}
                      placeholder={t('settings.basic.industryContextPlaceholder')}
                      error={errors.industry_context?.message}
                      {...register('industry_context')}
                    />
                    <p className="mt-1 text-xs text-gray-400">{t('settings.basic.industryContextHint')}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </form>

      {/* 功能开关（在 form 外避免 react-hook-form 干扰） */}
      {activeTab === 'basic' && (
        <div className="max-w-2xl mt-4">
          <div className="rounded-lg border bg-white p-4 sm:p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">{t('settings.features.title')}</h2>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">{t('settings.features.aiAgent')}</p>
                <p className="text-xs text-gray-400 mt-0.5">{t('settings.features.aiAgentHint')}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const next = data?.ai_agent_enabled !== 'false' ? 'false' : 'true'
                  crmApi.put('/admin/settings', { ai_agent_enabled: next }).then(() =>
                    queryClient.invalidateQueries({ queryKey: ['system-settings'] })
                  )
                }}
                className={`relative inline-flex h-6 w-11 cursor-pointer items-center rounded-full transition-colors focus:outline-none ${
                  data?.ai_agent_enabled !== 'false' ? 'bg-primary-600' : 'bg-gray-200'
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  data?.ai_agent_enabled !== 'false' ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <Button form="basic-settings-form" type="submit" loading={isSubmitting || saveMutation.isPending}>
              {t('settings.basic.save')}
            </Button>
            {saved && <span className="text-sm text-green-600">{t('settings.basic.saved')}</span>}
          </div>
        </div>
      )}

      {/* 团队编辑 / 新建弹窗（挂在顶层，供选项配置子 Tab 使用） */}
      {editTarget && (
        <Modal
          title={t('settings.teams.edit', { name: editTarget.name })}
          onClose={() => setEditTarget(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditTarget(null)}>{t('common.cancel')}</Button>
              <Button loading={updateTeam.isPending} onClick={teamForm.handleSubmit((d) => updateTeam.mutate({ id: editTarget.id, ...d }))}>{t('common.save')}</Button>
            </>
          }
        >
          <div className="space-y-3">
            <Input label={t('settings.teams.name')} error={teamForm.formState.errors.name?.message} {...teamForm.register('name')} />
            <Input label={t('settings.teams.region')} placeholder={t('settings.teams.regionPlaceholder')} {...teamForm.register('region')} />
          </div>
        </Modal>
      )}
      {showAdd && (
        <Modal
          title={t('settings.teams.new')}
          onClose={() => { setShowAdd(false); addForm.reset() }}
          footer={
            <>
              <Button variant="secondary" onClick={() => { setShowAdd(false); addForm.reset() }}>{t('common.cancel')}</Button>
              <Button loading={addTeam.isPending} onClick={addForm.handleSubmit((d) => addTeam.mutate(d))}>{t('common.create')}</Button>
            </>
          }
        >
          <div className="space-y-3">
            <Input label={t('settings.teams.name')} error={addForm.formState.errors.name?.message} {...addForm.register('name')} />
            <Input label={t('settings.teams.region')} placeholder={t('settings.teams.regionPlaceholder')} {...addForm.register('region')} />
          </div>
        </Modal>
      )}

      {/* 选项配置 */}
      {activeTab === 'options' && (
        <div>
          <div className="mb-4 flex gap-1 border-b overflow-x-auto overflow-y-hidden scrollbar-none">
            {OPTION_GROUPS.map((g) => (
              <button
                key={g.key}
                type="button"
                onClick={() => setActiveGroup(g.key)}
                className={`whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  activeGroup === g.key
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {g.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setActiveGroup('teams')}
              className={`whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeGroup === 'teams'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t('settings.teams.title')}
            </button>
          </div>

          {activeGroup === 'teams' ? (
            <div className="max-w-2xl">
              <div className="rounded-lg border bg-white overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
                  <span className="text-sm font-medium text-gray-700">{t('settings.teams.list')}</span>
                  <Button size="sm" onClick={() => { setShowAdd(true); addForm.reset() }}>+ {t('settings.teams.new')}</Button>
                </div>
                {teamsLoading ? (
                  <div className="py-8 text-center text-sm text-gray-400">{t('common.loading')}</div>
                ) : !teams?.length ? (
                  <div className="py-8 text-center text-sm text-gray-400">{t('settings.teams.empty')}</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-700">{t('settings.teams.cols.name')}</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-700">{t('settings.teams.cols.region')}</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {teams.map((team) => (
                        <tr key={team.id}>
                          <td className="px-4 py-3 font-medium text-gray-900">{team.name}</td>
                          <td className="px-4 py-3 text-gray-500">{team.region ?? '—'}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2 justify-end">
                              <button onClick={() => openEdit(team)} className="text-xs text-primary-600 hover:text-primary-800">{t('common.edit')}</button>
                              <span className="text-gray-300">|</span>
                              <button
                                onClick={() => { if (confirm(t('settings.teams.deleteConfirm', { name: team.name }))) deleteTeam.mutate(team.id) }}
                                className="text-xs text-red-500 hover:text-red-700"
                              >{t('common.delete')}</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ) : (
            <OptionGroupPanel
              key={activeGroup}
              groupKey={activeGroup}
              noAdd={OPTION_GROUPS_KEYS.find((g) => g.key === activeGroup)?.noAdd ?? false}
            />
          )}
        </div>
      )}

      {/* 回收站 */}
      {activeTab === 'trash' && <RecycleBinPanel />}

      {/* AI 与自动化：AI 配置在上，工作流在下 */}
      {activeTab === 'automation' && (
        <div className="space-y-6">
          {/* 模型提供商 */}
          <div className="rounded-lg border bg-white overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
              <h2 className="font-semibold text-gray-800 text-sm">{t('settings.ai.provider')}</h2>
              <Button size="sm" onClick={() => setShowAddProvider(true)}>{t('settings.ai.addProvider')}</Button>
            </div>

            {/* 添加提供商表单 */}
            {showAddProvider && (
              <div className="p-4 border-b bg-blue-50 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label={t('settings.ai.name')}
                    placeholder={t('settings.ai.namePlaceholder')}
                    value={aiProviderForm.name}
                    onChange={(e) => setAiProviderForm((f) => ({ ...f, name: e.target.value }))}
                  />
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('settings.ai.type')}</label>
                    <select
                      className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      value={aiProviderForm.providerType}
                      onChange={(e) => setAiProviderForm((f) => ({ ...f, providerType: e.target.value }))}
                    >
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="cloudflare">Cloudflare Workers AI</option>
                      <option value="custom">{t('settings.ai.customProvider')}</option>
                    </select>
                  </div>
                  {aiProviderForm.providerType === 'cloudflare' ? (
                    <div className="sm:col-span-2">
                      <p className="text-sm text-blue-600 bg-blue-50 rounded px-3 py-2">
                        {t('settings.ai.cloudflareHint')}
                      </p>
                    </div>
                  ) : (
                    <Input
                      label="API Key"
                      placeholder="sk-..."
                      value={aiProviderForm.apiKey}
                      onChange={(e) => setAiProviderForm((f) => ({ ...f, apiKey: e.target.value }))}
                    />
                  )}
                  {aiProviderForm.providerType !== 'anthropic' && aiProviderForm.providerType !== 'cloudflare' && (
                    <div>
                      <Input
                        label={aiProviderForm.providerType === 'openai' ? t('settings.ai.baseUrl') : 'Base URL'}
                        placeholder={t('settings.ai.baseUrlPlaceholder')}
                        value={aiProviderForm.baseUrl}
                        onChange={(e) => setAiProviderForm((f) => ({ ...f, baseUrl: e.target.value }))}
                      />
                      <p className="mt-1 text-xs text-gray-400">
                        {t('settings.ai.baseUrlHint')}
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    loading={addProvider.isPending}
                    onClick={() => addProvider.mutate(aiProviderForm)}
                    disabled={!aiProviderForm.name || (aiProviderForm.providerType !== 'cloudflare' && !aiProviderForm.apiKey)}
                  >
                    {t('common.save')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setShowAddProvider(false)}>{t('common.cancel')}</Button>
                </div>
              </div>
            )}

            {aiProviders.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">{t('settings.ai.noProviders')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">{t('settings.ai.name')}</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">{t('settings.ai.type')}</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">API Key</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">Base URL</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {aiProviders.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium text-gray-900">{p.name}</td>
                      <td className="px-4 py-2.5 text-gray-500 capitalize">{p.providerType}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{p.apiKeyMasked}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{p.baseUrl ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => fetchAvailableModels(p.id)}
                            disabled={loadingModelsFor === p.id}
                            className="text-xs text-primary-600 hover:text-primary-800 font-medium disabled:opacity-50"
                          >
                            {loadingModelsFor === p.id ? t('settings.ai.querying') : t('settings.ai.queryModels')}
                          </button>
                          <span className="text-gray-300">|</span>
                          <button
                            onClick={() => { if (confirm(t('settings.ai.deleteConfirm', { name: p.name }))) deleteProvider.mutate(p.id) }}
                            className="text-xs text-red-500 hover:text-red-700"
                          >
                            {t('common.delete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* 查询到的可用模型 */}
          {modelsProviderId && (
            <div className="rounded-lg border bg-white overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
                <h2 className="font-semibold text-gray-800 text-sm">
                  {t('settings.ai.availableModels', { name: aiProviders.find((p) => p.id === modelsProviderId)?.name ?? '' })}
                </h2>
                <button onClick={() => { setModelsProviderId(null); setAvailableModels(null); setModelsError(null) }}
                  className="text-xs text-gray-400 hover:text-gray-600">{t('common.close')}</button>
              </div>

              {modelsError ? (
                <div className="px-4 py-4 space-y-3">
                  <p className="text-sm text-red-500">{modelsError}</p>
                  <div className="rounded-md border border-gray-200 bg-gray-50 p-3 space-y-2">
                    <p className="text-xs font-medium text-gray-600">{t('settings.ai.manualInput')}</p>
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <label className="block text-xs text-gray-500 mb-1">{t('settings.ai.modelId')}</label>
                        <input
                          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                          placeholder={t('settings.ai.modelIdPlaceholder')}
                          value={manualModel.modelId}
                          onChange={(e) => setManualModel((m) => ({ ...m, modelId: e.target.value }))}
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs text-gray-500 mb-1">{t('settings.ai.displayName')}</label>
                        <input
                          className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                          placeholder={t('settings.ai.displayNamePlaceholder')}
                          value={manualModel.displayName}
                          onChange={(e) => setManualModel((m) => ({ ...m, displayName: e.target.value }))}
                        />
                      </div>
                      <Button
                        size="sm"
                        disabled={!manualModel.modelId || !manualModel.displayName || enableModel.isPending}
                        loading={enableModel.isPending}
                        onClick={() => {
                          enableModel.mutate(
                            { providerId: modelsProviderId!, modelId: manualModel.modelId, displayName: manualModel.displayName },
                            { onSuccess: () => setManualModel({ modelId: '', displayName: '' }) },
                          )
                        }}
                      >
                        {t('common.add')}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : !availableModels ? (
                <p className="px-4 py-4 text-sm text-gray-400">{t('common.loading')}</p>
              ) : (
                <div className="max-h-72 overflow-y-auto divide-y divide-gray-100">
                  {availableModels.map((m) => {
                    const already = aiModels.some(
                      (em) => em.providerId === modelsProviderId && em.modelId === m.id,
                    )
                    return (
                      <div key={m.id} className="flex items-center justify-between px-4 py-2.5">
                        <div>
                          <span className="text-sm font-medium text-gray-800">{m.name}</span>
                          {m.name !== m.id && <span className="ml-2 text-xs text-gray-400">{m.id}</span>}
                        </div>
                        {already ? (
                          <span className="text-xs text-green-600 font-medium">{t('settings.ai.enabled')}</span>
                        ) : (
                          <button
                            onClick={() => enableModel.mutate({
                              providerId: modelsProviderId!,
                              modelId: m.id,
                              displayName: m.name,
                            })}
                            disabled={enableModel.isPending}
                            className="text-xs text-primary-600 hover:text-primary-800 font-medium disabled:opacity-50"
                          >
                            {t('common.enable')}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* 已启用模型 */}
          <div className="rounded-lg border bg-white overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50">
              <h2 className="font-semibold text-gray-800 text-sm">{t('settings.ai.enabledModels')}</h2>
            </div>
            {aiModels.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">{t('settings.ai.noEnabledModels')}</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {aiModels.map((m) => (
                  <div key={m.id}>
                    <div className="flex items-center px-4 py-2.5 hover:bg-gray-50">
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-gray-900 text-sm">{m.displayName}</span>
                        <span className="ml-2 font-mono text-xs text-gray-400">{m.modelId}</span>
                        <span className="ml-2 text-xs text-gray-400">· {m.providerName}</span>
                      </div>
                      <div className="flex items-center gap-3 ml-4 flex-shrink-0">
                        <button
                          onClick={() => {
                            if (testModelId === m.id) {
                              setTestModelId(null); setTestResult(null); setTestError(null)
                            } else {
                              setTestModelId(m.id); setTestResult(null); setTestError(null)
                            }
                          }}
                          className={`text-xs font-medium ${testModelId === m.id ? 'text-gray-400' : 'text-primary-600 hover:text-primary-800'}`}
                        >
                          {testModelId === m.id ? t('settings.ai.collapse') : t('settings.ai.test')}
                        </button>
                        <span className="text-gray-300">|</span>
                        <button
                          onClick={() => { if (confirm(t('settings.ai.removeModelConfirm', { name: m.displayName }))) removeModel.mutate(m.id) }}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          {t('settings.ai.remove')}
                        </button>
                      </div>
                    </div>

                    {/* 测试面板 */}
                    {testModelId === m.id && (
                      <div className="px-4 pb-4 pt-2 bg-gray-50 border-t border-gray-100 space-y-3">
                        <div className="flex gap-2">
                          <input
                            className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                            value={testPrompt}
                            onChange={(e) => setTestPrompt(e.target.value)}
                            placeholder={t('settings.ai.testPlaceholder')}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !testLoading) runTest(m.id) }}
                          />
                          <Button
                            size="sm"
                            loading={testLoading}
                            disabled={!testPrompt.trim()}
                            onClick={() => runTest(m.id)}
                          >
                            {t('settings.ai.send')}
                          </Button>
                        </div>
                        {testLoading && (
                          <p className="text-xs text-gray-400">{t('settings.ai.requesting')}</p>
                        )}
                        {testError && (
                          <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">
                            {testError}
                          </div>
                        )}
                        {testResult && (
                          <div className="rounded bg-white border border-gray-200 px-3 py-2 space-y-1">
                            <p className="text-sm text-gray-800 whitespace-pre-wrap">{testResult.reply}</p>
                            <p className="text-xs text-gray-400">{t('settings.ai.responseTime', { ms: testResult.latencyMs })}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* AI 分析提示词 */}
          <AiPromptsPanel />

          {/* 工作流 */}
          <WorkflowsPanel
            autoAssignEnabled={data?.auto_assign_enabled !== 'false'}
            onSettingsSaved={() => queryClient.invalidateQueries({ queryKey: ['system-settings'] })}
          />
        </div>
      )}
    </div>
  )
}

// ─── AI 分析提示词配置面板 ────────────────────────────────────────────────────

interface AiPrompt {
  id: string
  key: string
  name: string
  systemPrompt: string
  userPromptTemplate: string
  modelId: string | null
  isActive: number
}

const PROMPT_VARS: Record<string, { key: string; descKey: string }[]> = {
  lead_analysis: [
    { key: 'today',            descKey: 'settings.prompts.vars.today' },
    { key: 'name',             descKey: 'settings.prompts.vars.name' },
    { key: 'source',           descKey: 'settings.prompts.vars.source' },
    { key: 'status',           descKey: 'settings.prompts.vars.status' },
    { key: 'intended_services',descKey: 'settings.prompts.vars.intendedServices' },
    { key: 'next_contact_date',descKey: 'settings.prompts.vars.nextContactDate' },
    { key: 'assigned_to_name', descKey: 'settings.prompts.vars.assignedName' },
    { key: 'activities',       descKey: 'settings.prompts.vars.activities' },
    { key: 'activity_types',   descKey: 'settings.prompts.vars.activityTypes' },
  ],
  client_analysis: [
    { key: 'today',               descKey: 'settings.prompts.vars.today' },
    { key: 'name',                descKey: 'settings.prompts.vars.name' },
    { key: 'contract_status',     descKey: 'settings.prompts.vars.contractStatus' },
    { key: 'service_plans',       descKey: 'settings.prompts.vars.servicePlans' },
    { key: 'next_contact_date',   descKey: 'settings.prompts.vars.nextContactDate' },
    { key: 'assigned_sales_name', descKey: 'settings.prompts.vars.assignedSalesName' },
    { key: 'activities',          descKey: 'settings.prompts.vars.activities' },
    { key: 'activity_types',      descKey: 'settings.prompts.vars.activityTypes' },
  ],
}

function AiPromptsPanel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{ systemPrompt: string; userPromptTemplate: string } | null>(null)
  const [showVars, setShowVars] = useState(false)

  const { data: promptsData, isLoading } = useQuery({
    queryKey: ['ai-prompts'],
    queryFn: () => crmApi.get<{ data: AiPrompt[] }>('/admin/ai/prompts').then((r) => r.data.data),
  })
  const prompts = promptsData ?? []

  const saveMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: string; systemPrompt: string; userPromptTemplate: string }) =>
      crmApi.put(`/admin/ai/prompts/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-prompts'] })
      setEditId(null)
      setEditForm(null)
    },
  })

  const openEdit = (p: AiPrompt) => {
    setEditId(p.id)
    setEditForm({ systemPrompt: p.systemPrompt, userPromptTemplate: p.userPromptTemplate })
    setShowVars(false)
  }

  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      <div className="px-4 py-3 border-b bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-700">{t('settings.ai.promptTitle')}</h3>
        <p className="text-xs text-gray-400 mt-0.5">{t('settings.ai.promptSubtitle')}</p>
      </div>

      {isLoading ? (
        <div className="p-4 text-sm text-gray-400">{t('common.loading')}</div>
      ) : (
        <div className="divide-y">
          {prompts.map((p) => (
            <div key={p.id} className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="text-sm font-medium text-gray-800">{p.name}</span>
                  <span className="ml-2 text-xs text-gray-400 font-mono">{p.key}</span>
                </div>
                {editId !== p.id ? (
                  <button onClick={() => openEdit(p)} className="text-xs text-primary-600 hover:text-primary-800">{t('common.edit')}</button>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setEditId(null); setEditForm(null) }}
                      className="text-xs text-gray-400 hover:text-gray-600"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={() => saveMutation.mutate({ id: p.id, ...editForm! })}
                      className="text-xs text-primary-600 hover:text-primary-800 font-medium"
                    >
                      {saveMutation.isPending ? t('settings.ai.saving') : t('common.save')}
                    </button>
                  </div>
                )}
              </div>

              {editId === p.id && editForm ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{t('settings.ai.systemPrompt')}</label>
                    <textarea
                      rows={3}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary-500 resize-y"
                      value={editForm.systemPrompt}
                      onChange={(e) => setEditForm((f) => f ? { ...f, systemPrompt: e.target.value } : f)}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-medium text-gray-600">{t('settings.ai.userPrompt')}</label>
                      <button
                        type="button"
                        onClick={() => setShowVars((v) => !v)}
                        className="text-xs text-gray-400 hover:text-gray-600"
                      >
                        {showVars ? t('settings.ai.collapseVars') : t('settings.ai.showVars')}
                      </button>
                    </div>
                    {showVars && (
                      <div className="mb-2 rounded-md border border-gray-200 bg-gray-50 p-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                          {(PROMPT_VARS[p.key] ?? []).map((v) => (
                            <div key={v.key} className="flex items-baseline gap-1.5 text-xs">
                              <code className="font-mono text-primary-700 bg-white border border-gray-200 rounded px-1">{`{{${v.key}}}`}</code>
                              <span className="text-gray-400">{t(v.descKey)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <textarea
                      rows={12}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary-500 resize-y"
                      value={editForm.userPromptTemplate}
                      onChange={(e) => setEditForm((f) => f ? { ...f, userPromptTemplate: e.target.value } : f)}
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div>
                    <p className="text-xs text-gray-400 mb-1">{t('settings.ai.systemRole')}</p>
                    <p className="text-xs text-gray-600 bg-gray-50 rounded p-2 line-clamp-2">{p.systemPrompt || t('settings.ai.notConfigured')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">{t('settings.ai.userPromptLabel')}</p>
                    <p className="text-xs text-gray-600 bg-gray-50 rounded p-2 line-clamp-3 whitespace-pre-wrap">{p.userPromptTemplate || t('settings.ai.notConfigured')}</p>
                  </div>
                </div>
              )}
            </div>
          ))}
          {prompts.length === 0 && (
            <p className="p-4 text-sm text-gray-400">{t('settings.ai.noPrompt')}</p>
          )}
        </div>
      )}
    </div>
  )
}
