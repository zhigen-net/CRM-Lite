import { useState } from 'react'
import { useTranslation } from 'react-i18next'

// ── 文档目录结构 ───────────────────────────────────────────────────────────────

type SectionKey = 'intro' | 'vars' | 'actions' | 'tips' | 'api-overview' | 'api-leads'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) || window.location.origin

const EXAMPLE_REQUEST = `POST ${API_BASE_URL}/api/v1/leads
Content-Type: application/json
X-API-Key: crm_xxxxxxxxxxxxxxxx

{
  "source": "百度推广",
  "name": "张三",
  "contactInfo": "13800000000",
  "intendedServices": ["试管婴儿"],
  "notes": "客户咨询过一次",
  "adInfo": {
    "ip": "1.2.3.4",
    "url": "https://landing.example.com/ivf",
    "账户": "百度账户A",
    "广告计划": "试管婴儿-全国",
    "广告组": "25-35岁女性",
    "广告": "创意文案01"
  }
}`

const EXAMPLE_RESPONSE = `HTTP/1.1 201 Created
Content-Type: application/json

{
  "data": {
    "id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "status": "New"
  }
}`

// ── 各章节内容 ─────────────────────────────────────────────────────────────────

function SectionIntro() {
  const { t } = useTranslation()
  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">{t('docs.intro.title')}</h2>
      <p className="text-sm text-gray-500 mb-6">{t('docs.intro.subtitle')}</p>

      <p className="text-sm text-gray-600 mb-6">{t('docs.intro.body')}</p>

      <div className="rounded-lg border border-gray-200 overflow-hidden mb-6">
        <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{t('docs.intro.flowTitle')}</p>
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
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{t('docs.intro.triggerTitle')}</p>
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
        <p className="text-sm font-semibold text-amber-800 mb-1">{t('docs.intro.asyncTitle')}</p>
        <p className="text-sm text-amber-700">
          {t('docs.intro.asyncDescPre')}
          <code className="mx-1 text-xs bg-amber-100 rounded px-1">set_field</code>
          {t('docs.intro.asyncDescPost')}
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
      <h2 className="text-xl font-bold text-gray-900 mb-1">{t('docs.vars.title')}</h2>
      <p className="text-sm text-gray-500 mb-6">{t('docs.vars.subtitle')}</p>

      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 mb-6">
        <p className="text-sm font-medium text-gray-700 mb-3">{t('docs.vars.syntaxTitle')}</p>
        <div className="flex flex-wrap gap-6">
          <div>
            <p className="text-xs text-gray-500 mb-1">{t('docs.vars.basicUsageLabel')}</p>
            <code className="text-sm font-mono text-primary-700">{'你好，{{name}}'}</code>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">{t('docs.vars.namespaceUsageLabel')}</p>
            <code className="text-sm font-mono text-primary-700">{'{{lead.name}}  /  {{client.name}}'}</code>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          {t('docs.vars.unrecognizedPre')}
          <strong>{t('docs.vars.unrecognizedHighlight')}</strong>
          {t('docs.vars.unrecognizedPost')}
        </p>
      </div>

      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {([['lead', t('docs.vars.tabLead')], ['client', t('docs.vars.tabClient')], ['time', t('docs.vars.tabTime')]] as const).map(([key, label]) => (
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
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 w-52">{t('docs.vars.colVar')}</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600">{t('docs.vars.colDesc')}</th>
              {varEntity === 'time' && (
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 w-40">{t('docs.vars.colExample')}</th>
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
          <p className="text-xs text-gray-500">{t('docs.vars.timeNote')}</p>
        )}
        {varEntity === 'lead' && (
          <p className="text-xs text-gray-500">
            <code className="text-primary-700">assignedToName</code> / <code className="text-primary-700">assignedToEmail</code> {t('docs.vars.leadNotePost')}
          </p>
        )}
        {varEntity === 'client' && (
          <p className="text-xs text-gray-500">
            <code className="text-primary-700">assignedSalesName</code> / <code className="text-primary-700">assignedSalesEmail</code> {t('docs.vars.clientNotePost')}
            <code className="text-primary-700 mx-1">servicePlans</code>{t('docs.vars.clientNoteServicePlans')}
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
      <h2 className="text-xl font-bold text-gray-900 mb-1">{t('docs.actionsSection.title')}</h2>
      <p className="text-sm text-gray-500 mb-6">{t('docs.actionsSection.subtitle')}</p>

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
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('docs.actionsSection.configExampleLabel')}</p>
                  <pre className="bg-gray-900 text-green-300 rounded-lg p-4 text-xs font-mono whitespace-pre-wrap leading-relaxed overflow-x-auto overflow-y-hidden">
                    {t(`docs.actions.${type}.example`)}
                  </pre>
                </div>
                {notes.length > 0 && (
                  <div className="rounded-md bg-blue-50 border border-blue-100 px-4 py-3">
                    <p className="text-xs font-semibold text-blue-700 mb-1.5">{t('docs.actionsSection.notesLabel')}</p>
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
      <h2 className="text-xl font-bold text-gray-900 mb-1">{t('docs.tipsSection.title')}</h2>
      <p className="text-sm text-gray-500 mb-6">{t('docs.tipsSection.subtitle')}</p>

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

function CodeBlock({ code }: { code: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="relative group">
      <pre className="bg-gray-900 text-green-300 rounded-lg p-4 text-xs font-mono whitespace-pre-wrap leading-relaxed overflow-x-auto overflow-y-hidden">
        {code}
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 px-2 py-1 rounded text-xs bg-gray-700 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-600"
      >
        {copied ? t('docs.copied') : t('docs.copyBtn')}
      </button>
    </div>
  )
}

function SectionApiOverview() {
  const { t } = useTranslation()

  const API_ERROR_CODES = [
    { code: 401, descKey: 'docs.api.errorCodes.401' },
    { code: 400, descKey: 'docs.api.errorCodes.400' },
    { code: 500, descKey: 'docs.api.errorCodes.500' },
  ]

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">{t('docs.api.overview.title')}</h2>
      <p className="text-sm text-gray-500 mb-6">{t('docs.api.overview.subtitle')}</p>

      <div className="rounded-lg border border-gray-200 overflow-hidden mb-6">
        <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{t('docs.api.overview.authTitle')}</p>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-gray-600">
            {t('docs.api.overview.authDesc')} <code className="text-primary-700 bg-primary-50 border border-primary-100 rounded px-1.5 py-0.5 text-xs">X-API-Key</code> {t('docs.api.overview.authDescPost')}
          </p>
          <div className="rounded-md bg-gray-900 text-green-300 p-3 text-xs font-mono">
            X-API-Key: crm_xxxxxxxxxxxxxxxx
          </div>
          <p className="text-xs text-gray-500">
            {t('docs.api.overview.keyNote')} <code className="text-gray-600">crm_</code> {t('docs.api.overview.keyNotePost')}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 overflow-hidden mb-6">
        <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{t('docs.api.overview.endpointsTitle')}</p>
        </div>
        <div className="divide-y divide-gray-100">
          <div className="flex items-center gap-4 px-4 py-3">
            <span className="text-xs font-bold text-white bg-green-600 rounded px-2 py-0.5">POST</span>
            <code className="text-sm text-gray-800 font-mono">/api/v1/leads</code>
            <span className="ml-auto text-sm text-gray-500">{t('docs.api.overview.submitLeadsLabel')}</span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 overflow-hidden mb-6">
        <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{t('docs.api.overview.errorsTitle')}</p>
        </div>
        <div className="divide-y divide-gray-100">
          {API_ERROR_CODES.map(({ code, descKey }) => (
            <div key={code} className="flex items-center gap-4 px-4 py-3">
              <span className={`text-xs font-bold rounded px-2 py-0.5 ${
                code === 401 ? 'bg-red-100 text-red-700' :
                code === 400 ? 'bg-yellow-100 text-yellow-700' :
                'bg-gray-100 text-gray-700'
              }`}>{code}</span>
              <span className="text-sm text-gray-600">{t(descKey)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-semibold text-blue-800 mb-1">{t('docs.api.overview.autoAssignTitle')}</p>
        <p className="text-sm text-blue-700">{t('docs.api.overview.autoAssignDesc')}</p>
      </div>
    </div>
  )
}

function SectionApiLeads() {
  const { t } = useTranslation()

  const V1_LEAD_FIELDS = [
    { field: 'source',           type: 'string',   required: true,  descKey: 'docs.api.leads.fields.source' },
    { field: 'name',             type: 'string',   required: true,  descKey: 'docs.api.leads.fields.name' },
    { field: 'contactInfo',      type: 'string',   required: true,  descKey: 'docs.api.leads.fields.contactInfo' },
    { field: 'intendedServices', type: 'string[]', required: true,  descKey: 'docs.api.leads.fields.intendedServices' },
    { field: 'notes',            type: 'string',   required: false, descKey: 'docs.api.leads.fields.notes' },
    { field: 'adInfo',           type: 'object',   required: false, descKey: 'docs.api.leads.fields.adInfo' },
  ]

  const AD_INFO_FIELDS = [
    { field: 'ip',      descKey: 'docs.api.leads.adInfoFields.ip' },
    { field: 'url',     descKey: 'docs.api.leads.adInfoFields.url' },
    { field: '账户',    descKey: 'docs.api.leads.adInfoFields.account' },
    { field: '广告计划', descKey: 'docs.api.leads.adInfoFields.plan' },
    { field: '广告组',  descKey: 'docs.api.leads.adInfoFields.group' },
    { field: '广告',    descKey: 'docs.api.leads.adInfoFields.ad' },
  ]

  const fallbackItems = t('docs.api.leads.fallbackItems', { returnObjects: true }) as string[]

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-1">{t('docs.api.leads.title')}</h2>
      <p className="text-sm text-gray-500 mb-6">{t('docs.api.leads.subtitle')}</p>

      <div className="rounded-lg border border-gray-200 overflow-hidden mb-6">
        <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200 flex items-center gap-3">
          <span className="text-xs font-bold text-white bg-green-600 rounded px-2 py-0.5">POST</span>
          <code className="text-sm font-mono text-gray-800">{API_BASE_URL}/api/v1/leads</code>
        </div>
        <div className="p-4">
          <p className="text-xs text-gray-500">{t('docs.api.leads.headerNote')}</p>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 overflow-hidden mb-6">
        <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{t('docs.api.leads.reqFieldsTitle')}</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 w-44">{t('docs.api.leads.cols.field')}</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 w-24">{t('docs.api.leads.cols.type')}</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600 w-16">{t('docs.api.leads.cols.required')}</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-600">{t('docs.api.leads.cols.desc')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {V1_LEAD_FIELDS.map(({ field, type, required, descKey }) => (
              <tr key={field} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <code className="text-xs text-primary-700 bg-primary-50 border border-primary-100 rounded px-1.5 py-0.5">{field}</code>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-gray-500 font-mono">{type}</span>
                </td>
                <td className="px-4 py-3">
                  {required
                    ? <span className="text-xs font-medium text-red-600">{t('docs.api.leads.requiredLabel')}</span>
                    : <span className="text-xs text-gray-400">{t('docs.api.leads.optionalLabel')}</span>
                  }
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">{t(descKey)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-blue-100 overflow-hidden mb-6">
        <div className="bg-blue-50 px-4 py-2.5 border-b border-blue-100">
          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">{t('docs.api.leads.adInfoTitle')}</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-blue-50 border-b border-blue-100">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-blue-600 w-32">{t('docs.api.leads.adInfoCols.field')}</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-blue-600">{t('docs.api.leads.adInfoCols.desc')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-blue-50">
            {AD_INFO_FIELDS.map(({ field, descKey }) => (
              <tr key={field} className="hover:bg-blue-50/50">
                <td className="px-4 py-3">
                  <code className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded px-1.5 py-0.5">{field}</code>
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">{t(descKey)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-blue-100 bg-blue-50/50">
          <p className="text-xs text-blue-600">{t('docs.api.leads.adInfoNote')}</p>
        </div>
      </div>

      <div className="mb-6">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('docs.api.leads.reqExampleLabel')}</p>
        <CodeBlock code={EXAMPLE_REQUEST} />
      </div>

      <div className="mb-6">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('docs.api.leads.successLabel')}</p>
        <CodeBlock code={EXAMPLE_RESPONSE} />
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-800 mb-2">{t('docs.api.leads.fallbackTitle')}</p>
        <ul className="space-y-1.5">
          {fallbackItems.map((text, i) => (
            <li key={i} className="text-sm text-amber-700 flex gap-2">
              <span className="flex-none mt-0.5">•</span>
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ── 主页面 ─────────────────────────────────────────────────────────────────────

export default function DocsPage() {
  const { t } = useTranslation()
  const [activeCategory, setActiveCategory] = useState('workflow')
  const [activeSection, setActiveSection] = useState<SectionKey>('intro')

  const DOC_CATEGORIES = [
    {
      key: 'workflow',
      label: t('docs.nav.workflow'),
      sections: [
        { key: 'intro'   as SectionKey, label: t('docs.sections.intro') },
        { key: 'vars'    as SectionKey, label: t('docs.sections.vars') },
        { key: 'actions' as SectionKey, label: t('docs.sections.actions') },
        { key: 'tips'    as SectionKey, label: t('docs.sections.tips') },
      ],
    },
    {
      key: 'api',
      label: t('docs.nav.api'),
      sections: [
        { key: 'api-overview' as SectionKey, label: t('docs.sections.apiOverview') },
        { key: 'api-leads'    as SectionKey, label: t('docs.sections.apiLeads') },
      ],
    },
  ]

  const category = DOC_CATEGORIES.find((c) => c.key === activeCategory)!

  const handleCategoryClick = (catKey: string) => {
    const cat = DOC_CATEGORIES.find((c) => c.key === catKey)
    setActiveCategory(catKey)
    if (cat?.sections[0]) setActiveSection(cat.sections[0].key)
  }

  return (
    <div className="flex h-full">
      {/* 左侧文档导航 */}
      <aside className="hidden md:flex flex-col w-52 flex-shrink-0 border-r border-gray-200 bg-white py-6 px-3">
        {DOC_CATEGORIES.map((cat) => (
          <div key={cat.key} className="mb-4">
            <button
              onClick={() => handleCategoryClick(cat.key)}
              className="px-3 mb-1 text-xs font-semibold text-gray-400 uppercase tracking-wider hover:text-gray-600 w-full text-left"
            >
              {cat.label}
            </button>
            <div className="space-y-0.5">
              {cat.sections.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => { setActiveCategory(cat.key); setActiveSection(key) }}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    activeSection === key
                      ? 'bg-primary-50 text-primary-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </aside>

      {/* 移动端顶部章节切换 */}
      <div className="md:hidden fixed top-14 left-0 right-0 z-20 bg-white border-b border-gray-200 px-4 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-1">
          {category.sections.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveSection(key)}
              className={`flex-none px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeSection === key
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 内容区 */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8 mt-10 md:mt-0">
          {activeSection === 'intro'        && <SectionIntro />}
          {activeSection === 'vars'         && <SectionVars />}
          {activeSection === 'actions'      && <SectionActions />}
          {activeSection === 'tips'         && <SectionTips />}
          {activeSection === 'api-overview' && <SectionApiOverview />}
          {activeSection === 'api-leads'    && <SectionApiLeads />}
        </div>
      </main>
    </div>
  )
}
