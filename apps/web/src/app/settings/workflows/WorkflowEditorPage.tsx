import { useState, useRef, useCallback, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { crmApi } from '@/shared/utils/request'
import { Button } from '@/shared/components/Button'
import { Badge } from '@/shared/components/Badge'
import type { Workflow } from '@/shared/hooks/useWorkflows'
import { useOptions } from '@/shared/hooks/useOptions'
import type { OptionItem } from '@/shared/hooks/useOptions'
import { WorkflowHelpButton } from './WorkflowHelp'

// ─── 类型定义 ──────────────────────────────────────────────────────────────────

interface EntityField {
  field: string
  label: string
  type: 'select' | 'datetime' | 'services' | 'text' | 'user' | 'team'
  optionGroup?: string
  triggerOnly?: boolean
}

type ReqField = { field: string; label: string; type: 'datetime' | 'select' | 'services' | 'text'; optionGroup?: string }

type WfTriggerType = 'field_change' | 'on_create' | 'scheduled'
type ScheduledCondition = 'date_is_today' | 'date_overdue' | 'no_activity_days'
type ConditionOperator = 'eq' | 'neq' | 'contains' | 'not_contains' | 'is_empty' | 'is_not_empty'
type ConditionLogic = 'and' | 'or'

type WfActionForm =
  | { id: string; type: 'require_activity'; contentRequired: boolean; contentPresets: string }
  | { id: string; type: 'require_fields';   fields: ReqField[] }
  | { id: string; type: 'set_field';        field: string; label: string; value: string }
  | { id: string; type: 'send_email';       to: string; subject: string; body: string }
  | { id: string; type: 'webhook';          url: string; method: 'POST' | 'GET'; body: string }

interface ConditionRow {
  id: string
  field: string
  operator: ConditionOperator
  value: string
}

interface EditorForm {
  name: string
  entityType: string
  isActive: boolean
  triggerType: WfTriggerType
  triggerField: string
  triggerValue: string
  scheduledCondition: ScheduledCondition
  scheduledDays: number
  conditionLogic: ConditionLogic
  conditions: ConditionRow[]
  actions: WfActionForm[]
}

// ─── 常量 ──────────────────────────────────────────────────────────────────────

const TRIGGER_TYPES: { type: WfTriggerType; labelKey: string; descKey: string }[] = [
  { type: 'field_change', labelKey: 'settings.workflow.trigger.types.field_change', descKey: 'settings.workflow.trigger.types.field_changeHint' },
  { type: 'on_create',    labelKey: 'settings.workflow.trigger.types.on_create',    descKey: 'settings.workflow.trigger.types.on_createHint' },
  { type: 'scheduled',    labelKey: 'settings.workflow.trigger.types.scheduled',    descKey: 'settings.workflow.trigger.types.scheduledHint' },
]

const SCHEDULED_CONDITIONS: { value: ScheduledCondition; labelKey: string; needsField: boolean; needsDays: boolean }[] = [
  { value: 'date_is_today',    labelKey: 'settings.workflow.trigger.types.date_equals_today', needsField: true,  needsDays: false },
  { value: 'date_overdue',     labelKey: 'settings.workflow.trigger.types.date_overdue',      needsField: true,  needsDays: false },
  { value: 'no_activity_days', labelKey: 'settings.workflow.trigger.types.no_activity',       needsField: false, needsDays: true  },
]

const ACTION_TYPES: { type: WfActionForm['type']; labelKey: string }[] = [
  { type: 'require_activity', labelKey: 'settings.workflow.actions.types.require_activity' },
  { type: 'require_fields',   labelKey: 'settings.workflow.actions.types.require_fields' },
  { type: 'set_field',        labelKey: 'settings.workflow.actions.types.set_field' },
  { type: 'send_email',       labelKey: 'settings.workflow.actions.types.send_email' },
  { type: 'webhook',          labelKey: 'settings.workflow.actions.types.webhook' },
]

const CONDITION_OPERATORS: { value: ConditionOperator; labelKey: string; needsValue: boolean }[] = [
  { value: 'eq',           labelKey: 'settings.workflow.operators.eq',           needsValue: true  },
  { value: 'neq',          labelKey: 'settings.workflow.operators.neq',          needsValue: true  },
  { value: 'contains',     labelKey: 'settings.workflow.operators.contains',     needsValue: true  },
  { value: 'not_contains', labelKey: 'settings.workflow.operators.not_contains', needsValue: true  },
  { value: 'is_empty',     labelKey: 'settings.workflow.operators.is_empty',     needsValue: false },
  { value: 'is_not_empty', labelKey: 'settings.workflow.operators.is_not_empty', needsValue: false },
]

const TEMPLATE_VAR_GROUPS: { labelKey: string; entityType: 'lead' | 'client' | 'activity' | null; vars: { key: string; descKey: string }[] }[] = [
  {
    labelKey: 'settings.workflow.actions.sendEmail.varLead', entityType: 'lead' as const,
    vars: [
      { key: 'name', descKey: 'settings.workflow.actions.sendEmail.vars.lead.name' },
      { key: 'contactInfo', descKey: 'settings.workflow.actions.sendEmail.vars.lead.contactInfo' },
      { key: 'source', descKey: 'settings.workflow.actions.sendEmail.vars.lead.source' },
      { key: 'status', descKey: 'settings.workflow.actions.sendEmail.vars.lead.status' },
      { key: 'intendedServices', descKey: 'settings.workflow.actions.sendEmail.vars.lead.intendedServices' },
      { key: 'lostReason', descKey: 'settings.workflow.actions.sendEmail.vars.lead.lostReason' },
      { key: 'nextContactDate', descKey: 'settings.workflow.actions.sendEmail.vars.lead.nextContactDate' },
      { key: 'notes', descKey: 'settings.workflow.actions.sendEmail.vars.lead.notes' },
      { key: 'assignedToName', descKey: 'settings.workflow.actions.sendEmail.vars.lead.assignedToName' },
      { key: 'assignedToEmail', descKey: 'settings.workflow.actions.sendEmail.vars.lead.assignedToEmail' },
      { key: 'createdAt', descKey: 'settings.workflow.actions.sendEmail.vars.lead.createdAt' },
    ],
  },
  {
    labelKey: 'settings.workflow.actions.sendEmail.varClient', entityType: 'client' as const,
    vars: [
      { key: 'name', descKey: 'settings.workflow.actions.sendEmail.vars.client.name' },
      { key: 'phone', descKey: 'settings.workflow.actions.sendEmail.vars.client.phone' },
      { key: 'email', descKey: 'settings.workflow.actions.sendEmail.vars.client.email' },
      { key: 'contractStatus', descKey: 'settings.workflow.actions.sendEmail.vars.client.contractStatus' },
      { key: 'servicePlans', descKey: 'settings.workflow.actions.sendEmail.vars.client.servicePlans' },
      { key: 'assignedSalesName', descKey: 'settings.workflow.actions.sendEmail.vars.client.assignedSalesName' },
      { key: 'assignedSalesEmail', descKey: 'settings.workflow.actions.sendEmail.vars.client.assignedSalesEmail' },
      { key: 'createdAt', descKey: 'settings.workflow.actions.sendEmail.vars.client.createdAt' },
    ],
  },
  {
    labelKey: 'settings.workflow.trigger.targets.activity', entityType: 'activity' as const,
    vars: [
      { key: 'activityType', descKey: 'settings.workflow.actions.sendEmail.vars.lead.status' },
      { key: 'description', descKey: 'settings.workflow.actions.sendEmail.vars.lead.notes' },
      { key: 'activityDate', descKey: 'settings.workflow.actions.sendEmail.vars.lead.createdAt' },
      { key: 'nextContactDate', descKey: 'settings.workflow.actions.sendEmail.vars.lead.nextContactDate' },
      { key: 'recorderName', descKey: 'settings.workflow.actions.sendEmail.vars.lead.assignedToName' },
      { key: 'recorderEmail', descKey: 'settings.workflow.actions.sendEmail.vars.lead.assignedToEmail' },
      { key: 'leadName', descKey: 'settings.workflow.actions.sendEmail.vars.lead.name' },
      { key: 'clientName', descKey: 'settings.workflow.actions.sendEmail.vars.client.name' },
    ],
  },
  {
    labelKey: 'settings.workflow.actions.sendEmail.varTime', entityType: null,
    vars: [
      { key: 'now', descKey: 'settings.workflow.actions.sendEmail.vars.time.now' },
      { key: 'today', descKey: 'settings.workflow.actions.sendEmail.vars.time.today' },
      { key: 'tomorrow', descKey: 'settings.workflow.actions.sendEmail.vars.time.tomorrow' },
      { key: 'yesterday', descKey: 'settings.workflow.actions.sendEmail.vars.time.yesterday' },
      { key: 'weekStart', descKey: 'settings.workflow.actions.sendEmail.vars.time.weekStart' },
      { key: 'weekEnd', descKey: 'settings.workflow.actions.sendEmail.vars.time.weekEnd' },
      { key: 'monthStart', descKey: 'settings.workflow.actions.sendEmail.vars.time.monthStart' },
      { key: 'monthEnd', descKey: 'settings.workflow.actions.sendEmail.vars.time.monthEnd' },
    ],
  },
]

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────

function genId() { return Math.random().toString(36).slice(2, 9) }

function buildTrigger(f: EditorForm) {
  if (f.triggerType === 'on_create') return { type: 'on_create' as const }
  if (f.triggerType === 'scheduled') {
    const cond = f.scheduledCondition
    return {
      type: 'scheduled' as const, condition: cond,
      ...(SCHEDULED_CONDITIONS.find((c) => c.value === cond)?.needsField ? { field: f.triggerField } : {}),
      ...(cond === 'no_activity_days' ? { days: f.scheduledDays } : {}),
    }
  }
  return { type: 'field_change' as const, field: f.triggerField, to: f.triggerValue }
}

function buildPayload(f: EditorForm) {
  const ENTITY_LABELS_STATIC: Record<string, string> = { lead: 'lead', client: 'client', activity: 'activity' }
  const entityLabel = ENTITY_LABELS_STATIC[f.entityType] ?? f.entityType
  const schedCondValue = SCHEDULED_CONDITIONS.find((c) => c.value === f.scheduledCondition)?.value ?? f.scheduledCondition
  const triggerDesc = f.triggerType === 'on_create' ? 'on_create'
    : f.triggerType === 'scheduled'
    ? `scheduled·${schedCondValue}`
    : `${f.triggerField} → ${f.triggerValue === '*' ? '*' : f.triggerValue}`
  const name = f.name.trim() || `${entityLabel} · ${triggerDesc}`
  const conditions = f.conditions
    .filter((c) => c.field)
    .map(({ id: _id, ...c }) => c)
  return {
    name, entityType: f.entityType, isActive: f.isActive,
    trigger: buildTrigger(f),
    conditions: conditions.length ? [{ logic: f.conditionLogic, rows: conditions }] : [],
    actions: f.actions.map(({ id: _id, ...a }) => {
      const act = a as WfActionForm
      if (act.type === 'require_activity') {
        const presets = act.contentPresets
          ? act.contentPresets.split(/[,，、]/).map((s: string) => s.trim()).filter(Boolean)
          : []
        return { type: 'require_activity', contentRequired: act.contentRequired, ...(presets.length ? { contentPresets: presets } : {}) }
      }
      return a
    }),
  }
}

function formFromWorkflow(w: Workflow): EditorForm {
  const t = w.trigger as Record<string, unknown>
  const triggerType: WfTriggerType =
    t.type === 'on_create' ? 'on_create' : t.type === 'scheduled' ? 'scheduled' : 'field_change'
  const actions: WfActionForm[] = w.actions.map((a) => {
    const id = genId()
    if (a.type === 'require_activity') return { id, type: 'require_activity', contentRequired: a.contentRequired, contentPresets: a.contentPresets?.join(',') ?? '' }
    if (a.type === 'require_fields')   return { id, type: 'require_fields',   fields: a.fields as ReqField[] }
    if (a.type === 'set_field')        return { id, type: 'set_field',        field: (a as Record<string, string>).field ?? '', label: (a as Record<string, string>).label ?? '', value: (a as Record<string, string>).value ?? '' }
    if (a.type === 'send_email')       return { id, type: 'send_email',       to: (a as Record<string, string>).to ?? '', subject: (a as Record<string, string>).subject ?? '', body: (a as Record<string, string>).body ?? '' }
    return { id, type: 'webhook', url: (a as Record<string, string>).url ?? '', method: ((a as Record<string, string>).method ?? 'POST') as 'POST' | 'GET', body: (a as Record<string, string>).body ?? '{}' }
  })
  const condGroups = (w.conditions as Array<{ logic?: string; rows?: ConditionRow[] }>) ?? []
  const firstGroup = condGroups[0]
  const conditions: ConditionRow[] = (firstGroup?.rows ?? []).map((r) => ({ ...r, id: genId() }))
  return {
    name: w.name, entityType: w.entityType, isActive: !!w.isActive,
    triggerType, triggerField: (t.field as string) ?? '',
    triggerValue: t.type === 'field_change' ? (t.to as string) ?? '' : '',
    scheduledCondition: (t.condition as ScheduledCondition) ?? 'date_is_today',
    scheduledDays: (t.days as number) ?? 7,
    conditionLogic: (firstGroup?.logic as ConditionLogic) ?? 'and',
    conditions, actions,
  }
}

function emptyForm(): EditorForm {
  return {
    name: '', entityType: 'lead', isActive: true,
    triggerType: 'field_change', triggerField: '', triggerValue: '',
    scheduledCondition: 'date_is_today', scheduledDays: 7,
    conditionLogic: 'and', conditions: [], actions: [],
  }
}

// ─── 样式常量 ─────────────────────────────────────────────────────────────────

const CLS = {
  inp: 'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500',
  sel: 'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500',
  ta:  'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none',
}

// ─── 动作配置编辑器 ────────────────────────────────────────────────────────────

function ActionConfigEditor({
  action, onChange, requirableFields, entityFields, entityType, onFocusTextarea, salesUsers, teams,
}: {
  action: WfActionForm
  onChange: (patch: object) => void
  requirableFields: EntityField[]
  entityFields: EntityField[]
  entityType: string
  onFocusTextarea: (el: HTMLTextAreaElement | HTMLInputElement | null) => void
  salesUsers: { id: string; name: string }[]
  teams: { id: string; name: string }[]
}) {
  const { t } = useTranslation()

  if (action.type === 'require_activity') return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
        <input type="checkbox" className="rounded border-gray-300" checked={action.contentRequired}
          onChange={(e) => onChange({ contentRequired: e.target.checked })} />
        {t('settings.workflow.actions.requireActivity.required')}
      </label>
      <div>
        <label className="block text-xs text-gray-500 mb-1">{t('settings.workflow.actions.requireActivity.presets')}</label>
        <input className={CLS.inp} placeholder={t('settings.workflow.actions.requireActivity.presetsPlaceholder')} value={action.contentPresets}
          onChange={(e) => onChange({ contentPresets: e.target.value })}
          onFocus={(e) => onFocusTextarea(e.target)} />
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

  if (action.type === 'set_field') {
    const selectedField = entityFields.find((f) => f.field === action.field)
    const isUserField = selectedField?.type === 'user'
    const isTeamField = selectedField?.type === 'team'
    return (
      <div className="space-y-2">
        <div>
          <label className="block text-xs text-gray-500 mb-1">{t('settings.workflow.actions.setField.targetField')}</label>
          <select className={CLS.sel} value={action.field}
            onChange={(e) => { const ef = entityFields.find((f) => f.field === e.target.value); onChange({ field: e.target.value, label: ef?.label ?? '', value: '' }) }}>
            <option value="">{t('settings.workflow.trigger.placeholder')}</option>
            {entityFields.filter((f) => !f.triggerOnly).map((ef) => <option key={ef.field} value={ef.field}>{ef.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">
            {isUserField ? t('settings.workflow.actions.setField.selectSales') : isTeamField ? t('settings.workflow.actions.setField.selectTeam') : t('settings.workflow.actions.setField.setValueHint')}
          </label>
          {isUserField ? (
            <select className={CLS.sel} value={action.value} onChange={(e) => onChange({ value: e.target.value })}>
              <option value="">{t('settings.workflow.actions.setField.salesPlaceholder')}</option>
              {salesUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          ) : isTeamField ? (
            <select className={CLS.sel} value={action.value} onChange={(e) => onChange({ value: e.target.value })}>
              <option value="">{t('settings.workflow.actions.setField.teamPlaceholder')}</option>
              {teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
            </select>
          ) : (
            <input className={CLS.inp} placeholder={t('settings.workflow.actions.setField.valuePlaceholder')} value={action.value}
              onChange={(e) => onChange({ value: e.target.value })}
              onFocus={(e) => onFocusTextarea(e.target)} />
          )}
        </div>
      </div>
    )
  }

  if (action.type === 'send_email') return (
    <div className="space-y-2">
      <div>
        <label className="block text-xs text-gray-500 mb-1">{t('settings.workflow.actions.sendEmail.to')}</label>
        <input className={CLS.inp} placeholder="{{assignedToEmail}}" value={action.to}
          onChange={(e) => onChange({ to: e.target.value })}
          onFocus={(e) => onFocusTextarea(e.target)} />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">{t('settings.workflow.actions.sendEmail.subject')}</label>
        <input className={CLS.inp} placeholder="{{name}}" value={action.subject}
          onChange={(e) => onChange({ subject: e.target.value })}
          onFocus={(e) => onFocusTextarea(e.target)} />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">{t('settings.workflow.actions.sendEmail.body')}</label>
        <textarea className={CLS.ta} rows={5} value={action.body}
          onChange={(e) => onChange({ body: e.target.value })}
          onFocus={(e) => onFocusTextarea(e.target)} />
      </div>
    </div>
  )

  if (action.type === 'webhook') return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="flex-none w-24">
          <label className="block text-xs text-gray-500 mb-1">{t('settings.workflow.actions.sendEmail.method')}</label>
          <select className={CLS.sel} value={action.method} onChange={(e) => onChange({ method: e.target.value })}>
            <option value="POST">POST</option><option value="GET">GET</option>
          </select>
        </div>
        <div className="flex-1 min-w-0">
          <label className="block text-xs text-gray-500 mb-1">URL</label>
          <input className={CLS.inp} placeholder="https://..." value={action.url}
            onChange={(e) => onChange({ url: e.target.value })}
            onFocus={(e) => onFocusTextarea(e.target)} />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">{t('settings.workflow.actions.sendEmail.bodyJson')}</label>
        <textarea className={CLS.ta} rows={5} value={action.body}
          onChange={(e) => onChange({ body: e.target.value })}
          onFocus={(e) => onFocusTextarea(e.target)} />
      </div>
    </div>
  )

  return null
}

// ─── 可拖拽动作卡片 ────────────────────────────────────────────────────────────

function SortableActionCard({
  action, onRemove, onChange, requirableFields, entityFields, entityType, onFocusTextarea, salesUsers, teams,
}: {
  action: WfActionForm
  onRemove: () => void
  onChange: (patch: object) => void
  requirableFields: EntityField[]
  entityFields: EntityField[]
  entityType: string
  onFocusTextarea: (el: HTMLTextAreaElement | HTMLInputElement | null) => void
  salesUsers: { id: string; name: string }[]
  teams: { id: string; name: string }[]
}) {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: action.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style} className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100 bg-gray-50 rounded-t-lg">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="flex-none cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 touch-none"
          title={t('settings.workflow.dragSort')}
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M7 2a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4zM7 8a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4zM7 14a2 2 0 110 4 2 2 0 010-4zm6 0a2 2 0 110 4 2 2 0 010-4z" />
          </svg>
        </button>
        <span className="flex-1 text-xs font-semibold text-gray-700">{t(`settings.workflow.actions.types.${action.type}`)}</span>
        <button type="button" onClick={onRemove} className="text-gray-400 hover:text-red-500 transition-colors">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="px-4 py-3">
        <ActionConfigEditor
          action={action} onChange={onChange}
          requirableFields={requirableFields} entityFields={entityFields}
          entityType={entityType} onFocusTextarea={onFocusTextarea}
          salesUsers={salesUsers} teams={teams}
        />
      </div>
    </div>
  )
}

// ─── 变量参考面板 ──────────────────────────────────────────────────────────────

function VariablePanel({
  entityType,
  onInsert,
}: {
  entityType: string
  onInsert: (varStr: string) => void
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState<string | null>(null)
  const groups = TEMPLATE_VAR_GROUPS.filter((g) => g.entityType === null || g.entityType === entityType)

  const handleClick = (key: string) => {
    const varStr = `{{${key}}}`
    onInsert(varStr)
    setCopied(key)
    navigator.clipboard.writeText(varStr).catch(() => {})
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1">{t('settings.workflow.templateVars')}</p>
        <p className="text-xs text-gray-400">{t('settings.workflow.templateVarsHint')}</p>
      </div>
      {groups.map((g) => (
        <div key={g.labelKey}>
          <p className="text-xs font-medium text-gray-500 mb-1.5">{t(g.labelKey)}</p>
          <div className="space-y-1">
            {g.vars.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => handleClick(v.key)}
                className={`w-full flex items-baseline gap-2 rounded px-2 py-1 text-left transition-colors group ${
                  copied === v.key ? 'bg-green-50 text-green-700' : 'hover:bg-gray-50'
                }`}
              >
                <code className={`flex-none text-xs font-mono rounded px-1 border ${
                  copied === v.key ? 'border-green-300 bg-green-100' : 'border-gray-200 bg-white text-primary-700'
                }`}>
                  {`{{${v.key}}}`}
                </code>
                <span className="text-xs text-gray-400 truncate">{copied === v.key ? t('common.copied') : t(v.descKey)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── 条件构建器 ────────────────────────────────────────────────────────────────

function ConditionsBuilder({
  conditions, logic, entityFields,
  onAdd, onRemove, onPatch, onLogicChange,
}: {
  conditions: ConditionRow[]
  logic: ConditionLogic
  entityFields: EntityField[]
  onAdd: () => void
  onRemove: (id: string) => void
  onPatch: (id: string, patch: Partial<ConditionRow>) => void
  onLogicChange: (l: ConditionLogic) => void
}) {
  const { t } = useTranslation()
  const { data: allOptions } = useOptions()

  return (
    <div className="space-y-3">
      {conditions.length === 0 && (
        <p className="text-sm text-gray-400 italic py-1">{t('settings.workflow.trigger.noCondition')}</p>
      )}

      {conditions.map((cond, idx) => {
        const fieldDef = entityFields.find((f) => f.field === cond.field)
        const opDef = CONDITION_OPERATORS.find((o) => o.value === cond.operator)
        const valueOptions = fieldDef?.optionGroup ? (allOptions?.[fieldDef.optionGroup] ?? []) : []

        return (
          <div key={cond.id}>
            {idx > 0 && (
              <div className="flex items-center gap-2 my-2">
                <div className="flex-1 h-px bg-gray-200" />
                <button
                  type="button"
                  onClick={() => onLogicChange(logic === 'and' ? 'or' : 'and')}
                  className="flex-none rounded-full border border-gray-300 bg-white px-3 py-0.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
                  title={t('settings.workflow.toggleAndOr')}
                >
                  {logic === 'and' ? 'AND' : 'OR'}
                </button>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
            )}
            <div className="flex items-start gap-2">
              <div className="flex-1 grid grid-cols-3 gap-2">
                <select
                  className={CLS.sel}
                  value={cond.field}
                  onChange={(e) => onPatch(cond.id, { field: e.target.value, value: '' })}
                >
                  <option value="">{t('settings.workflow.selectField')}</option>
                  {entityFields.map((ef) => <option key={ef.field} value={ef.field}>{ef.label}</option>)}
                </select>
                <select
                  className={CLS.sel}
                  value={cond.operator}
                  onChange={(e) => onPatch(cond.id, { operator: e.target.value as ConditionOperator })}
                >
                  {CONDITION_OPERATORS.map((o) => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
                </select>
                {opDef?.needsValue ? (
                  valueOptions.length > 0 ? (
                    <select className={CLS.sel} value={cond.value} onChange={(e) => onPatch(cond.id, { value: e.target.value })}>
                      <option value="">{t('common.selectPlaceholder')}</option>
                      {valueOptions.map((o: OptionItem) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input className={CLS.inp} placeholder={t('common.value')} value={cond.value}
                      onChange={(e) => onPatch(cond.id, { value: e.target.value })} />
                  )
                ) : (
                  <div />
                )}
              </div>
              <button type="button" onClick={() => onRemove(cond.id)} className="mt-1.5 text-gray-400 hover:text-red-500 transition-colors flex-none">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )
      })}

      <button type="button" onClick={onAdd}
        className="inline-flex items-center gap-1.5 text-xs text-primary-600 hover:text-primary-800 font-medium transition-colors">
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        {t('settings.workflow.addCondition')}
      </button>
    </div>
  )
}

// ─── 主页面 ────────────────────────────────────────────────────────────────────

function useEntitySchema() {
  return useQuery({
    queryKey: ['entity-schema'],
    queryFn: () =>
      crmApi.get<{ data: Record<string, EntityField[]> }>('/admin/entity-schema').then((r) => r.data.data),
    staleTime: 1000 * 60 * 5,
  })
}

export default function WorkflowEditorPage() {
  const { wfId } = useParams<{ wfId: string }>()
  const isNew = !wfId || wfId === 'new'
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const focusedRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)
  const [form, setForm] = useState<EditorForm>(emptyForm)
  const [saveError, setSaveError] = useState<string | null>(null)

  const { data: schema } = useEntitySchema()
  const { data: existingWf, isLoading: wfLoading } = useQuery({
    queryKey: ['admin-workflow', wfId],
    queryFn: () =>
      crmApi.get<{ data: Workflow }>(`/admin/workflows/${wfId}`).then((r) => r.data.data),
    enabled: !isNew,
  })

  useEffect(() => {
    if (existingWf) setForm(formFromWorkflow(existingWf))
  }, [existingWf])

  const { data: allOptions } = useOptions()

  const { data: usersData } = useQuery({
    queryKey: ['users-sales'],
    queryFn: () => crmApi.get<{ data: { id: string; name: string; role: string }[] }>('/users').then((r) => r.data.data),
  })
  const salesUsers = (usersData ?? []).filter((u) => u.role === 'sales')

  const { data: teamsData } = useQuery({
    queryKey: ['teams'],
    queryFn: () => crmApi.get<{ data: { id: string; name: string }[] }>('/teams').then((r) => r.data.data),
  })
  const teams = teamsData ?? []

  const set = useCallback((patch: Partial<EditorForm>) => setForm((f) => ({ ...f, ...patch })), [])

  const saveMutation = useMutation({
    mutationFn: (payload: ReturnType<typeof buildPayload>) =>
      isNew
        ? crmApi.post('/admin/workflows', payload)
        : crmApi.put(`/admin/workflows/${wfId}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-workflows'] })
      queryClient.invalidateQueries({ queryKey: ['workflows'] })
      navigate('/app/settings?tab=automation')
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setSaveError(msg ?? t('common.saveFailed'))
    },
  })

  const entityFields: EntityField[] = schema?.[form.entityType] ?? []
  const requirableFields = entityFields.filter((f) => !f.triggerOnly)
  const triggerFieldDef = entityFields.find((f) => f.field === form.triggerField)
  const triggerValueOptions = triggerFieldDef?.optionGroup ? (allOptions?.[triggerFieldDef.optionGroup] ?? []) : []
  const dateFields = entityFields.filter((f) => f.type === 'datetime')
  const scheduledCondDef = SCHEDULED_CONDITIONS.find((c) => c.value === form.scheduledCondition)

  const triggerReady =
    form.triggerType === 'on_create' ||
    (form.triggerType === 'field_change' && !!form.triggerField && !!form.triggerValue) ||
    (form.triggerType === 'scheduled' && (
      (!scheduledCondDef?.needsField || !!form.triggerField) &&
      (!scheduledCondDef?.needsDays  || form.scheduledDays > 0)
    ))

  const canSave = triggerReady && form.actions.length > 0

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setForm((f) => {
        const oldIdx = f.actions.findIndex((a) => a.id === active.id)
        const newIdx = f.actions.findIndex((a) => a.id === over.id)
        return { ...f, actions: arrayMove(f.actions, oldIdx, newIdx) }
      })
    }
  }

  const addAction = (type: WfActionForm['type']) => {
    const id = genId()
    const defaults: Record<WfActionForm['type'], WfActionForm> = {
      require_activity: { id, type: 'require_activity', contentRequired: false, contentPresets: '' },
      require_fields:   { id, type: 'require_fields',   fields: [] },
      set_field:        { id, type: 'set_field',        field: '', label: '', value: '' },
      send_email:       { id, type: 'send_email',       to: '', subject: '', body: '' },
      webhook:          { id, type: 'webhook',          url: '', method: 'POST', body: '{}' },
    }
    set({ actions: [...form.actions, defaults[type]] })
  }

  const removeAction = (actionId: string) =>
    set({ actions: form.actions.filter((a) => a.id !== actionId) })

  const patchAction = (actionId: string, patch: object) =>
    set({ actions: form.actions.map((a) => a.id === actionId ? { ...a, ...patch } as WfActionForm : a) })

  const addCondition = () =>
    set({ conditions: [...form.conditions, { id: genId(), field: '', operator: 'eq', value: '' }] })

  const removeCondition = (id: string) =>
    set({ conditions: form.conditions.filter((c) => c.id !== id) })

  const patchCondition = (id: string, patch: Partial<ConditionRow>) =>
    set({ conditions: form.conditions.map((c) => c.id === id ? { ...c, ...patch } : c) })

  const handleInsertVar = (varStr: string) => {
    const el = focusedRef.current
    if (!el) return
    const start = el.selectionStart ?? el.value.length
    const end   = el.selectionEnd   ?? el.value.length
    const before = el.value.slice(0, start)
    const after  = el.value.slice(end)
    const newVal = before + varStr + after
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value',
    )?.set
    nativeInputValueSetter?.call(el, newVal)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + varStr.length, start + varStr.length)
    })
  }

  if (!isNew && wfLoading) {
    return <div className="p-6 text-sm text-gray-500">{t('common.loading')}</div>
  }

  return (
    <div className="p-4 sm:p-6">
      {/* 返回 */}
      <button
        type="button"
        onClick={() => navigate('/app/settings?tab=automation')}
        className="mb-4 text-sm text-gray-500 hover:text-gray-700"
      >
        ← {t('common.back')}
      </button>

      {/* 页面标题行 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-gray-900">
            {isNew ? t('settings.workflow.createTitle') : t('settings.workflow.editTitle')}
          </h1>
          {!isNew && form.name && (
            <p className="mt-0.5 text-sm text-gray-500">{form.name}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <WorkflowHelpButton />
          {/* 启用开关 */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <span className="text-sm text-gray-600">{t('common.enable')}</span>
            <button
              type="button"
              onClick={() => set({ isActive: !form.isActive })}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${form.isActive ? 'bg-primary-600' : 'bg-gray-200'}`}
            >
              <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${form.isActive ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </label>
          <Button variant="secondary" size="sm" onClick={() => navigate('/app/settings?tab=automation')}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            loading={saveMutation.isPending}
            disabled={!canSave}
            onClick={() => { setSaveError(null); saveMutation.mutate(buildPayload(form)) }}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>

      {saveError && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
          {saveError}
        </div>
      )}

      <div className="flex gap-6 items-start">

        {/* 左侧主区域 */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* 工作流名称 + 对象 */}
          <div className="rounded-lg border bg-white p-4 sm:p-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings.workflow.actions.workflowName')}</label>
                <input
                  className={CLS.inp}
                  placeholder={t('settings.workflow.namePlaceholder')}
                  value={form.name}
                  onChange={(e) => set({ name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings.workflow.trigger.target')}</label>
                <select
                  className={CLS.sel}
                  value={form.entityType}
                  onChange={(e) => set({ entityType: e.target.value, triggerField: '', triggerValue: '', conditions: [], actions: [] })}
                >
                  <option value="lead">{t('settings.workflow.trigger.targets.lead')}</option>
                  <option value="client">{t('settings.workflow.trigger.targets.client')}</option>
                  <option value="activity">{t('settings.workflow.trigger.targets.activity')}</option>
                </select>
              </div>
            </div>
          </div>

            {/* 触发器 */}
            <div className="rounded-lg border bg-white p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="flex-none w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center">1</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">{t('settings.workflow.trigger.title')}</p>
                  <p className="text-xs text-gray-400">{t('settings.workflow.trigger.subtitle')}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-4">
                {TRIGGER_TYPES.filter((tt) =>
                  form.entityType !== 'activity' || tt.type !== 'scheduled'
                ).map((tt) => (
                  <button key={tt.type} type="button"
                    onClick={() => set({ triggerType: tt.type, triggerField: '', triggerValue: '' })}
                    className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      form.triggerType === tt.type ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
                    }`}>
                    <p className={`text-sm font-medium ${form.triggerType === tt.type ? 'text-primary-700' : 'text-gray-700'}`}>{t(tt.labelKey)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{t(tt.descKey)}</p>
                  </button>
                ))}
              </div>

              {/* 字段变更配置 */}
              {form.triggerType === 'field_change' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings.workflow.trigger.watchField')}</label>
                    <select className={CLS.sel} value={form.triggerField}
                      onChange={(e) => set({ triggerField: e.target.value, triggerValue: '' })}>
                      <option value="">{t('settings.workflow.trigger.placeholder')}</option>
                      {entityFields.map((ef) => <option key={ef.field} value={ef.field}>{ef.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings.workflow.trigger.changeTo')}</label>
                    {triggerValueOptions.length > 0 ? (
                      <select className={CLS.sel} value={form.triggerValue}
                        onChange={(e) => set({ triggerValue: e.target.value })}>
                        <option value="">{t('settings.workflow.trigger.placeholder')}</option>
                        <option value="*">{t('settings.workflow.trigger.anyChange')}</option>
                        {triggerValueOptions.map((o: OptionItem) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <input className={CLS.inp} placeholder={t('settings.workflow.trigger.targetValueHint')}
                        value={form.triggerValue === '*' ? '' : form.triggerValue}
                        onChange={(e) => set({ triggerValue: e.target.value || '*' })} />
                    )}
                    {form.triggerValue === '*' && (
                      <p className="text-xs text-amber-600 mt-1">{t('settings.workflow.trigger.anyChangeHint')}</p>
                    )}
                  </div>
                </div>
              )}

              {/* 新建时：无配置 */}
              {form.triggerType === 'on_create' && (
                <p className="text-sm text-gray-400 italic">{t('settings.workflow.onCreateNoConfig')}</p>
              )}

              {/* 定时触发配置 */}
              {form.triggerType === 'scheduled' && (
                <div className="space-y-3">
                  <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-700">
                    {t('settings.workflow.trigger.dailyScanHint')}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings.workflow.trigger.matchConditions')}</label>
                      <select className={CLS.sel} value={form.scheduledCondition}
                        onChange={(e) => set({ scheduledCondition: e.target.value as ScheduledCondition, triggerField: '' })}>
                        {SCHEDULED_CONDITIONS.map((c) => <option key={c.value} value={c.value}>{t(c.labelKey)}</option>)}
                      </select>
                    </div>
                    {scheduledCondDef?.needsField && (
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings.workflow.trigger.dateField')}</label>
                        <select className={CLS.sel} value={form.triggerField}
                          onChange={(e) => set({ triggerField: e.target.value })}>
                          <option value="">{t('settings.workflow.trigger.placeholder')}</option>
                          {dateFields.map((ef) => <option key={ef.field} value={ef.field}>{ef.label}</option>)}
                        </select>
                      </div>
                    )}
                    {scheduledCondDef?.needsDays && (
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">{t('settings.workflow.trigger.daysThreshold')}</label>
                        <div className="flex items-center gap-2">
                          <input type="number" min={1} max={365} className={`${CLS.inp} w-24`}
                            value={form.scheduledDays}
                            onChange={(e) => set({ scheduledDays: Math.max(1, Number(e.target.value)) })} />
                          <span className="text-sm text-gray-500">{t('settings.workflow.trigger.daysNoActivity')}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 条件构建器 */}
            <div className="rounded-lg border bg-white p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="flex-none w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center">2</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">{t('settings.workflow.conditionOptional')}</p>
                  <p className="text-xs text-gray-400">{t('settings.workflow.conditionHint')}</p>
                </div>
              </div>
              <ConditionsBuilder
                conditions={form.conditions}
                logic={form.conditionLogic}
                entityFields={entityFields}
                onAdd={addCondition}
                onRemove={removeCondition}
                onPatch={patchCondition}
                onLogicChange={(l) => set({ conditionLogic: l })}
              />
            </div>

            {/* 动作列表（可拖拽排序） */}
            <div className="rounded-lg border bg-white p-4 sm:p-6">
              <div className="flex items-center gap-2 mb-4">
                <span className="flex-none w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center">3</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">{t('settings.workflow.actions.title')}</p>
                  <p className="text-xs text-gray-400">{t('settings.workflow.actions.subtitle')}</p>
                </div>
              </div>

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={form.actions.map((a) => a.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-3 mb-4">
                    {form.actions.length === 0 && (
                      <p className="text-sm text-gray-400 italic py-1">{t('settings.workflow.actions.empty')}</p>
                    )}
                    {form.actions.map((action) => (
                      <SortableActionCard
                        key={action.id}
                        action={action}
                        onRemove={() => removeAction(action.id)}
                        onChange={(p) => patchAction(action.id, p)}
                        requirableFields={requirableFields}
                        entityFields={entityFields}
                        entityType={form.entityType}
                        onFocusTextarea={(el) => { focusedRef.current = el }}
                        salesUsers={salesUsers} teams={teams}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              {/* 添加动作按钮组 */}
              <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                {ACTION_TYPES.filter((at) =>
                  form.entityType !== 'activity' || (at.type === 'send_email' || at.type === 'webhook')
                ).map((at) => (
                  <button
                    key={at.type}
                    type="button"
                    onClick={() => addAction(at.type)}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-colors"
                  >
                    <svg className="h-3 w-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    {t(at.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            {/* 保存提示 */}
            {!canSave && form.actions.length === 0 && (
              <p className="text-xs text-amber-600 text-center">{t('settings.workflow.needsAction')}</p>
            )}
          </div>

          {/* 右侧变量面板 */}
          <div className="hidden lg:block flex-none w-56 sticky top-6">
            <div className="rounded-lg border bg-white p-4">
              <VariablePanel entityType={form.entityType} onInsert={handleInsertVar} />
            </div>
          </div>
        </div>
    </div>
  )
}
