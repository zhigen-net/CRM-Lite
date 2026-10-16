// 工作流使用说明：在工作流列表和编辑器里以抽屉形式打开（原「文档」页的工作流部分）
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

function SectionIntro() {
  const { t } = useTranslation()
  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">{t('workflowHelp.intro.title')}</h2>
      <p className="text-sm text-gray-500 mb-6">{t('workflowHelp.intro.subtitle')}</p>

      <p className="text-sm text-gray-600 mb-6">{t('workflowHelp.intro.body')}</p>

      <div className="rounded-lg border border-gray-200 overflow-hidden mb-6">
        <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{t('workflowHelp.intro.flowTitle')}</p>
        </div>
        <div className="p-6">
          <div className="flex items-start gap-4">
            {([
              { stepKey: 'trigger', color: 'bg-blue-100 text-blue-700' },
              { stepKey: 'match',   color: 'bg-yellow-100 text-yellow-700' },
              { stepKey: 'execute', color: 'bg-green-100 text-green-700' },
            ] as const).map(({ stepKey, color }, i, arr) => (
              <div key={stepKey} className="flex-1 flex items-start gap-3">
                <div className="flex-1 text-center">
                  <div className={`inline-flex items-center justify-center w-9 h-9 rounded-full text-sm font-bold mb-2 ${color}`}>{i + 1}</div>
                  <p className="text-sm font-semibold text-gray-800 mb-0.5">{t(`docs.intro.steps.${stepKey}.title`)}</p>
                  <p className="text-xs text-gray-500">{t(`docs.intro.steps.${stepKey}.desc`)}</p>
                </div>
                {i < arr.length - 1 && (
                  <div className="flex-none mt-4 text-gray-300 text-lg">→</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 overflow-hidden mb-6">
        <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{t('workflowHelp.intro.triggerTitle')}</p>
        </div>
        <div className="divide-y divide-gray-100">
          {(['onCreate', 'fieldChange', 'scheduled'] as const).map((key) => (
            <div key={key} className="flex gap-4 px-4 py-4">
              <div className="flex-none flex flex-col items-start gap-1">
                <span className="text-sm font-medium text-gray-800 whitespace-nowrap">{t(`docs.intro.triggers.${key}.label`)}</span>
                <code className="text-xs bg-gray-100 rounded px-1.5 py-0.5 text-gray-500">{t(`docs.intro.triggers.${key}.badge`)}</code>
              </div>
              <p className="text-sm text-gray-600 pt-0.5">{t(`docs.intro.triggers.${key}.desc`)}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-800 mb-1">{t('workflowHelp.intro.asyncTitle')}</p>
        <p className="text-sm text-amber-700">
          {t('workflowHelp.intro.asyncDescPre')}
          <code className="mx-1 text-xs bg-amber-100 rounded px-1">set_field</code>
          {t('workflowHelp.intro.asyncDescPost')}
        </p>
      </div>
    </div>
  )
}

function SectionVars() {
  const { t } = useTranslation()
  const [varEntity, setVarEntity] = useState<'lead' | 'client' | 'time'>('lead')

  const TEMPLATE_VAR_GROUPS = [
    {
      entityType: 'lead' as const,
      vars: [
        { key: 'name',             descKey: 'docs.varDescs.lead.name' },
        { key: 'contactInfo',      descKey: 'docs.varDescs.lead.contactInfo' },
        { key: 'source',           descKey: 'docs.varDescs.lead.source' },
        { key: 'status',           descKey: 'docs.varDescs.lead.status' },
        { key: 'intendedServices', descKey: 'docs.varDescs.lead.intendedServices' },
        { key: 'lostReason',       descKey: 'docs.varDescs.lead.lostReason' },
        { key: 'nextContactDate',  descKey: 'docs.varDescs.lead.nextContactDate' },
        { key: 'notes',            descKey: 'docs.varDescs.lead.notes' },
        { key: 'assignedToName',   descKey: 'docs.varDescs.lead.assignedToName' },
        { key: 'assignedToEmail',  descKey: 'docs.varDescs.lead.assignedToEmail' },
        { key: 'createdAt',        descKey: 'docs.varDescs.lead.createdAt' },
      ],
    },
    {
      entityType: 'client' as const,
      vars: [
        { key: 'name',               descKey: 'docs.varDescs.client.name' },
        { key: 'phone',              descKey: 'docs.varDescs.client.phone' },
        { key: 'email',              descKey: 'docs.varDescs.client.email' },
        { key: 'contractStatus',     descKey: 'docs.varDescs.client.contractStatus' },
        { key: 'servicePlans',       descKey: 'docs.varDescs.client.servicePlans' },
        { key: 'assignedSalesName',  descKey: 'docs.varDescs.client.assignedSalesName' },
        { key: 'assignedSalesEmail', descKey: 'docs.varDescs.client.assignedSalesEmail' },
        { key: 'createdAt',          descKey: 'docs.varDescs.client.createdAt' },
      ],
    },
    {
      entityType: null,
      vars: [
        { key: 'now',        descKey: 'docs.varDescs.time.now',        example: '2026-04-18 14:30' },
        { key: 'today',      descKey: 'docs.varDescs.time.today',      example: '2026-04-18' },
        { key: 'tomorrow',   descKey: 'docs.varDescs.time.tomorrow',   example: '2026-04-19' },
        { key: 'yesterday',  descKey: 'docs.varDescs.time.yesterday',  example: '2026-04-17' },
        { key: 'weekStart',  descKey: 'docs.varDescs.time.weekStart',  example: '2026-04-13' },
        { key: 'weekEnd',    descKey: 'docs.varDescs.time.weekEnd',    example: '2026-04-19' },
        { key: 'monthStart', descKey: 'docs.varDescs.time.monthStart', example: '2026-04-01' },
        { key: 'monthEnd',   descKey: 'docs.varDescs.time.monthEnd',   example: '2026-04-30' },
      ],
    },
  ]

  const group = TEMPLATE_VAR_GROUPS.find((g) =>
    varEntity === 'time' ? g.entityType === null : g.entityType === varEntity,
  )!

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">{t('workflowHelp.vars.title')}</h2>
      <p className="text-sm text-gray-500 mb-6">{t('workflowHelp.vars.subtitle')}</p>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 mb-6">
        <p className="text-sm font-medium text-gray-700 mb-3">{t('workflowHelp.vars.syntaxTitle')}</p>
        <div className="flex flex-wrap gap-6">
          <div>
            <p className="text-xs text-gray-500 mb-1">{t('workflowHelp.vars.basicUsageLabel')}</p>
            <code className="text-sm font-mono text-primary-700">{'你好，{{name}}'}</code>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">{t('workflowHelp.vars.namespaceUsageLabel')}</p>
            <code className="text-sm font-mono text-primary-700">{'{{lead.name}}  /  {{client.name}}'}</code>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          {t('workflowHelp.vars.unrecognizedPre')}
          <strong>{t('workflowHelp.vars.unrecognizedHighlight')}</strong>
          {t('workflowHelp.vars.unrecognizedPost')}
        </p>
      </div>

      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {([['lead', t('workflowHelp.vars.tabLead')], ['client', t('workflowHelp.vars.tabClient')], ['time', t('workflowHelp.vars.tabTime')]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setVarEntity(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              varEntity === key ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 w-52">{t('workflowHelp.vars.colVar')}</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600">{t('workflowHelp.vars.colDesc')}</th>
              {varEntity === 'time' && (
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 w-40">{t('workflowHelp.vars.colExample')}</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {group.vars.map((v) => (
              <tr key={v.key} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <code className="text-xs text-primary-700 bg-primary-50 border border-primary-100 rounded px-1.5 py-0.5">
                    {`{{${v.key}}}`}
                  </code>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{t(v.descKey)}</td>
                {varEntity === 'time' && (
                  <td className="px-4 py-3">
                    <code className="text-xs text-gray-400">{'example' in v ? v.example : ''}</code>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3">
        {varEntity === 'time' && (
          <p className="text-xs text-gray-500">{t('workflowHelp.vars.timeNote')}</p>
        )}
        {varEntity === 'lead' && (
          <p className="text-xs text-gray-500">
            <code className="text-primary-700">assignedToName</code> / <code className="text-primary-700">assignedToEmail</code> {t('workflowHelp.vars.leadNotePost')}
          </p>
        )}
        {varEntity === 'client' && (
          <p className="text-xs text-gray-500">
            <code className="text-primary-700">assignedSalesName</code> / <code className="text-primary-700">assignedSalesEmail</code> {t('workflowHelp.vars.clientNotePost')}
            <code className="text-primary-700 mx-1">servicePlans</code>{t('workflowHelp.vars.clientNoteServicePlans')}
          </p>
        )}
      </div>
    </div>
  )
}

function SectionActions() {
  const { t } = useTranslation()

  const ACTION_TYPES = ['set_field', 'send_email', 'webhook', 'require_activity', 'require_fields'] as const
  const ACTION_ICONS: Record<string, string> = {
    set_field: '✏️',
    send_email: '📧',
    webhook: '🔗',
    require_activity: '📝',
    require_fields: '📋',
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">{t('workflowHelp.actionsSection.title')}</h2>
      <p className="text-sm text-gray-500 mb-6">{t('workflowHelp.actionsSection.subtitle')}</p>

      <div className="space-y-5">
        {ACTION_TYPES.map((type) => {
          const notes = t(`docs.actions.${type}.notes`, { returnObjects: true }) as string[]
          return (
            <div key={type} className="rounded-lg border border-gray-200 overflow-hidden">
              <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center gap-2">
                <span className="text-lg">{ACTION_ICONS[type]}</span>
                <span className="font-semibold text-gray-800">{t(`docs.actions.${type}.label`)}</span>
                <code className="ml-auto text-xs bg-gray-200 text-gray-600 rounded px-2 py-0.5">{type}</code>
              </div>
              <div className="p-4 space-y-4">
                <p className="text-sm text-gray-600">{t(`docs.actions.${type}.desc`)}</p>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('workflowHelp.actionsSection.configExampleLabel')}</p>
                  <pre className="bg-gray-900 text-green-300 rounded-lg p-4 text-xs font-mono whitespace-pre-wrap leading-relaxed overflow-x-auto overflow-y-hidden">
                    {t(`docs.actions.${type}.example`)}
                  </pre>
                </div>
                {notes.length > 0 && (
                  <div className="rounded-md bg-blue-50 border border-blue-100 px-4 py-3">
                    <p className="text-xs font-semibold text-blue-700 mb-1.5">{t('workflowHelp.actionsSection.notesLabel')}</p>
                    <ul className="space-y-1">
                      {notes.map((note, i) => (
                        <li key={i} className="text-xs text-blue-700 flex gap-2">
                          <span className="flex-none">·</span>
                          <span>{note}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SectionTips() {
  const { t } = useTranslation()

  const TIPS = [
    { key: 'actionOrder',    color: 'border-blue-200 bg-blue-50',     titleColor: 'text-blue-800',   textColor: 'text-blue-700' },
    { key: 'emailConfig',    color: 'border-green-200 bg-green-50',   titleColor: 'text-green-800',  textColor: 'text-green-700' },
    { key: 'unmatched',      color: 'border-yellow-200 bg-yellow-50', titleColor: 'text-yellow-800', textColor: 'text-yellow-700' },
    { key: 'timing',         color: 'border-purple-200 bg-purple-50', titleColor: 'text-purple-800', textColor: 'text-purple-700' },
    { key: 'webhookSecurity',color: 'border-red-200 bg-red-50',       titleColor: 'text-red-800',    textColor: 'text-red-700' },
  ]

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">{t('workflowHelp.tipsSection.title')}</h2>
      <p className="text-sm text-gray-500 mb-6">{t('workflowHelp.tipsSection.subtitle')}</p>

      <div className="space-y-4">
        {TIPS.map(({ key, color, titleColor, textColor }) => {
          const items = t(`docs.tips.${key}.items`, { returnObjects: true }) as string[]
          return (
            <div key={key} className={`rounded-lg border p-4 ${color}`}>
              <p className={`text-sm font-semibold mb-2 ${titleColor}`}>{t(`docs.tips.${key}.title`)}</p>
              <ul className="space-y-1.5">
                {items.map((item, i) => (
                  <li key={i} className={`text-sm flex gap-2 ${textColor}`}>
                    <span className="flex-none mt-0.5">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const SECTIONS = ['intro', 'vars', 'actions', 'tips'] as const

export function WorkflowHelpButton() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState<typeof SECTIONS[number]>('intro')
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-primary-600 hover:text-primary-800">
        {t('workflowHelp.open')}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setOpen(false)}>
          <div className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 border-b bg-white">
              <div className="flex items-center justify-between px-5 py-4">
                <h2 className="text-base font-semibold text-gray-900">{t('workflowHelp.title')}</h2>
                <button onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full text-xl text-gray-400 hover:bg-gray-100">×</button>
              </div>
              <div className="flex gap-1 overflow-x-auto px-5">
                {SECTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => setSection(s)}
                    className={`-mb-px flex-none border-b-2 px-3 py-2 text-sm ${section === s ? 'border-primary-600 font-medium text-primary-600' : 'border-transparent text-gray-500'}`}>
                    {t(`workflowHelp.sections.${s}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="px-5 py-6">
              {section === 'intro' && <SectionIntro />}
              {section === 'vars' && <SectionVars />}
              {section === 'actions' && <SectionActions />}
              {section === 'tips' && <SectionTips />}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
