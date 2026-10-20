// 网站接入向导：选择网站类型与连接方式 → 配置变量 → 转发代码 → 页面脚本 → 检测与实时数据
import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { crmApi } from '@/shared/utils/request'
import { formatDate } from '@/shared/utils/format'
import { Button } from '@/shared/components/Button'
import { Input } from '@/shared/components/Input'
import { Modal } from '@/shared/components/Modal'

export interface GuideSite {
  id: string; name: string; domain: string | null; isActive: boolean; lastSeenAt: string | null; visitorCount: number
}
interface Integration {
  pagesFunction: string; workerSnippet: string; workerEntryLine: string
  assetsConfig: string; serviceBindingConfig: string; scriptTag: string
}
type CheckReason = 'ok' | 'unreachable' | 'not_found' | 'html' | 'redirect' | 'bad_key' | 'wrong_site' | 'server_error' | 'unexpected'
interface CheckStep { ok: boolean; status: number | null; reason: CheckReason }
interface CheckResult { host: string; script: CheckStep; collect: CheckStep }

type SiteType = 'pages' | 'worker'
type Connect = 'binding' | 'url'
const STEPS = ['prepare', 'secrets', 'code', 'script', 'verify'] as const

/** CRM 部署在 workers.dev 上时，子域名的第一段就是 Worker 名 */
function guessWorkerName(): string | null {
  const host = window.location.hostname
  return host.endsWith('.workers.dev') ? host.split('.')[0] ?? null : null
}

export function CopyBlock({ label, code }: { label?: string; code: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-gray-700">{label}</p>
        <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => {})}>
          {copied ? t('profile.api.copied') : t('profile.api.copy')}
        </Button>
      </div>
      <pre className="max-h-56 overflow-auto whitespace-pre rounded border bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700">{code}</pre>
    </div>
  )
}

function Choice({ active, title, hint, onClick }: { active: boolean; title: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-lg border p-3 text-left ${active ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500' : 'border-gray-200 hover:border-gray-300'}`}>
      <p className="text-sm font-medium text-gray-900">{title}</p>
      <p className="mt-0.5 text-xs text-gray-500">{hint}</p>
    </button>
  )
}

function Note({ children, tone = 'gray' }: { children: ReactNode; tone?: 'gray' | 'amber' | 'green' | 'red' }) {
  const cls = { gray: 'bg-gray-50 text-gray-600', amber: 'bg-amber-50 text-amber-800', green: 'bg-green-50 text-green-800', red: 'bg-red-50 text-red-700' }[tone]
  return <div className={`rounded-lg px-3 py-2 text-xs ${cls}`}>{children}</div>
}

function Mono({ children }: { children: ReactNode }) {
  return <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[11px] text-gray-800">{children}</code>
}

export function IntegrationGuide({ site, siteKey: initialKey, onClose }: { site: GuideSite; siteKey: string | null; onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [step, setStep] = useState(0)
  const [siteType, setSiteType] = useState<SiteType>('pages')
  const [connect, setConnect] = useState<Connect>('binding')
  const [siteKey, setSiteKey] = useState(initialKey)
  const [domain, setDomain] = useState(site.domain ?? '')
  const [check, setCheck] = useState<CheckResult | null>(null)
  const origin = window.location.origin
  const workerName = guessWorkerName()
  const current = STEPS[step]!

  const { data: tpl } = useQuery({
    queryKey: ['tracking-integration'],
    queryFn: () => crmApi.get<{ data: Integration }>('/admin/tracking-sites/integration').then((r) => r.data.data),
  })
  // 验证步骤中每 5 秒刷新站点的最近数据
  const { data: sites } = useQuery({
    queryKey: ['tracking-sites-admin'],
    queryFn: () => crmApi.get<{ data: GuideSite[] }>('/admin/tracking-sites').then((r) => r.data.data),
    refetchInterval: current === 'verify' ? 5000 : false,
  })
  const live = sites?.find((s) => s.id === site.id) ?? site

  const rotateMutation = useMutation({
    mutationFn: () => crmApi.post<{ data: { key: string } }>(`/admin/tracking-sites/${site.id}/rotate-key`, {}),
    onSuccess: (res) => { setSiteKey(res.data.data.key); queryClient.invalidateQueries({ queryKey: ['tracking-sites-admin'] }) },
  })
  const checkMutation = useMutation({
    mutationFn: () => crmApi.post<{ data: CheckResult }>(`/admin/tracking-sites/${site.id}/check`, { domain }),
    onSuccess: (res) => { setCheck(res.data.data); setDomain(res.data.data.host); queryClient.invalidateQueries({ queryKey: ['tracking-sites-admin'] }) },
    onError: () => setCheck(null),
  })

  const code = tpl ? (siteType === 'pages' ? tpl.pagesFunction : tpl.workerSnippet) : ''
  const aiPrompt = tpl ? t('analytics.guide.aiPrompt', {
    mode: t(`analytics.guide.siteTypes.${siteType}`),
    connect: t(`analytics.guide.aiConnect.${connect}`),
    place: t(`analytics.guide.aiPlace.${siteType}`),
    scriptTag: tpl.scriptTag,
    code,
  }) : ''

  const reasonText = (s: CheckStep) => t(`analytics.guide.verify.reasons.${s.reason}`, { status: s.status ?? '' })

  const body = (() => {
    switch (current) {
      case 'prepare': return (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">{t('analytics.guide.prepare.intro')}</p>
          <div>
            <p className="mb-2 text-xs font-medium text-gray-700">{t('analytics.guide.prepare.siteType')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['pages', 'worker'] as const).map((m) => (
                <Choice key={m} active={siteType === m} onClick={() => setSiteType(m)}
                  title={t(`analytics.guide.siteTypes.${m}`)} hint={t(`analytics.guide.prepare.siteTypeHint.${m}`)} />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-gray-700">{t('analytics.guide.prepare.account')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['binding', 'url'] as const).map((m) => (
                <Choice key={m} active={connect === m} onClick={() => setConnect(m)}
                  title={t(`analytics.guide.prepare.connect.${m}`)} hint={t(`analytics.guide.prepare.connectHint.${m}`)} />
              ))}
            </div>
          </div>
          <Note tone="amber">{t('analytics.guide.prepare.envNotice', { origin })}</Note>
        </div>
      )

      case 'secrets': return (
        <div className="space-y-4 text-sm text-gray-700">
          <p>{t('analytics.guide.secrets.path')}</p>
          <div className="space-y-2">
            <p className="font-medium">{t('analytics.guide.secrets.keyTitle')}</p>
            {siteKey ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p className="mb-2 text-xs text-amber-800">{t('analytics.guide.secrets.keyNotice')}</p>
                <CopyBlock label="CRM_SITE_KEY" code={siteKey} />
              </div>
            ) : (
              <Note>
                <p>{t('analytics.guide.secrets.keyHidden')}</p>
                <Button size="sm" variant="secondary" className="mt-2" loading={rotateMutation.isPending}
                  onClick={() => { if (confirm(t('analytics.sites.rotateConfirm', { name: site.name }))) rotateMutation.mutate() }}>
                  {t('analytics.guide.secrets.rotate')}
                </Button>
              </Note>
            )}
          </div>
          {connect === 'binding' ? (
            <div className="space-y-1">
              <p className="font-medium">{t('analytics.guide.secrets.bindingTitle')}</p>
              <ul className="list-disc space-y-1 pl-5 text-xs text-gray-600">
                <li>{t('analytics.guide.secrets.bindingName')} <Mono>CRM</Mono></li>
                <li>
                  {t('analytics.guide.secrets.bindingService')}
                  {workerName ? <> <Mono>{workerName}</Mono></> : <> {t('analytics.guide.secrets.bindingServiceUnknown')}</>}
                </li>
              </ul>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="font-medium">{t('analytics.guide.secrets.urlTitle')}</p>
              <CopyBlock label="CRM_URL" code={origin} />
            </div>
          )}
          <Note>
            <ul className="list-disc space-y-1 pl-4">
              {siteType === 'pages' && <li>{t('analytics.guide.secrets.pagesEnv')}</li>}
              <li>{t('analytics.guide.secrets.redeploy')}</li>
            </ul>
          </Note>
        </div>
      )

      case 'code': return tpl && (
        <div className="space-y-4 text-sm text-gray-700">
          {siteType === 'pages' ? (
            <>
              <p>{t('analytics.guide.code.pagesPlace')}</p>
              <CopyBlock label="functions/_t/[[path]].js" code={tpl.pagesFunction} />
              <Note>
                <ul className="list-disc space-y-1 pl-4">
                  <li>{t('analytics.guide.code.pagesRoutes')}</li>
                  <li>{t('analytics.guide.code.pagesAdvanced')}</li>
                </ul>
              </Note>
            </>
          ) : (
            <>
              <p>{t('analytics.guide.code.workerPlace')}</p>
              <CopyBlock label={t('analytics.guide.code.workerEntry')} code={tpl.workerEntryLine} />
              <CopyBlock label="forwardToCrm" code={tpl.workerSnippet} />
              <p>{t('analytics.guide.code.workerAssets')}</p>
              <CopyBlock label="wrangler.toml" code={tpl.assetsConfig} />
              {connect === 'binding' && (
                <>
                  <p className="text-xs text-gray-500">{t('analytics.guide.code.workerBinding')}</p>
                  <CopyBlock label="wrangler.toml" code={tpl.serviceBindingConfig.replace('<crm-worker-name>', workerName ?? t('analytics.guide.code.workerNamePlaceholder'))} />
                </>
              )}
            </>
          )}
          <p className="text-xs text-gray-500">{t('analytics.guide.code.noModify')}</p>
          <details className="rounded-lg border px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium text-gray-800">{t('analytics.guide.code.aiTitle')}</summary>
            <p className="my-2 text-xs text-gray-500">{t('analytics.guide.code.aiHint')}</p>
            <CopyBlock code={aiPrompt} />
          </details>
        </div>
      )

      case 'script': return tpl && (
        <div className="space-y-4 text-sm text-gray-700">
          <p>{t('analytics.guide.script.place')}</p>
          <CopyBlock code={tpl.scriptTag} />
          <Note>
            <ul className="list-disc space-y-1 pl-4">
              <li>{t('analytics.guide.script.spa')}</li>
              <li>{t('analytics.guide.script.form')}</li>
              <li>{t('analytics.guide.script.csp')}</li>
            </ul>
          </Note>
          <Note tone="amber">{t('analytics.guide.script.deploy')}</Note>
        </div>
      )

      case 'verify': return (
        <div className="space-y-4 text-sm text-gray-700">
          {!live.isActive && <Note tone="red">{t('analytics.guide.verify.disabled')}</Note>}
          <div className="space-y-2">
            <p className="font-medium">{t('analytics.guide.verify.checkTitle')}</p>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input placeholder="www.example.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
              </div>
              <Button loading={checkMutation.isPending} disabled={!domain.trim()} onClick={() => checkMutation.mutate()}>
                {t('analytics.guide.verify.check')}
              </Button>
            </div>
            <p className="text-xs text-gray-500">{t('analytics.guide.verify.checkHint')}</p>
            {checkMutation.isError && <Note tone="red">{(checkMutation.error as { response?: { data?: { message?: string } } }).response?.data?.message ?? t('common.opFailed')}</Note>}
            {check && (
              <div className="divide-y rounded-lg border">
                {(['script', 'collect'] as const).map((k) => (
                  <div key={k} className="flex gap-3 px-3 py-2">
                    <span className={`mt-0.5 text-sm ${check[k].ok ? 'text-green-600' : 'text-red-500'}`}>{check[k].ok ? '✓' : '✗'}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-gray-800">{t(`analytics.guide.verify.rows.${k}`)}</p>
                      <p className="text-xs text-gray-500">{reasonText(check[k])}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {check?.script.ok && check.collect.ok && <Note tone="green">{t('analytics.guide.verify.allOk')}</Note>}
          </div>

          <div className="space-y-2">
            <p className="font-medium">{t('analytics.guide.verify.liveTitle')}</p>
            {live.lastSeenAt ? (
              <Note tone="green">{t('analytics.guide.verify.liveReceived', { time: formatDate(live.lastSeenAt), count: live.visitorCount })}</Note>
            ) : (
              <Note>
                <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                {t('analytics.guide.verify.liveWaiting')}
              </Note>
            )}
          </div>

          <details className="rounded-lg border px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium text-gray-800">{t('analytics.guide.verify.manualTitle')}</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-gray-600">
              <li>{t('analytics.guide.verify.manual1')}</li>
              <li>{t('analytics.guide.verify.manual2')}</li>
              <li>{t('analytics.guide.verify.manual3')}</li>
              <li>{t('analytics.guide.verify.manual4')}</li>
            </ol>
          </details>
          <p className="text-xs text-gray-500">{t('analytics.guide.verify.multi')}</p>
        </div>
      )
    }
  })()

  return (
    <Modal size="lg" title={t('analytics.guide.title', { name: site.name })} onClose={onClose}
      footer={<>
        {step > 0 && <Button variant="secondary" onClick={() => setStep(step - 1)}>{t('analytics.guide.prev')}</Button>}
        {step < STEPS.length - 1
          ? <Button onClick={() => setStep(step + 1)}>{t('analytics.guide.next')}</Button>
          : <Button onClick={onClose}>{t('analytics.guide.done')}</Button>}
      </>}>
      <ol className="mb-5 flex gap-1">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <button type="button" onClick={() => setStep(i)} className="w-full text-left">
              <div className={`h-1 rounded-full ${i <= step ? 'bg-primary-500' : 'bg-gray-200'}`} />
              <p className={`mt-1.5 truncate text-[11px] ${i === step ? 'font-medium text-gray-900' : 'text-gray-400'}`}>
                {i + 1}. {t(`analytics.guide.steps.${s}`)}
              </p>
            </button>
          </li>
        ))}
      </ol>
      {body}
    </Modal>
  )
}
