// 站点「接入」：按部署平台与功能生成交给 AI 的提示词；也可以按步骤手动接入；最后检测并查看实时数据
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { crmApi } from '@/shared/utils/request'
import { formatDate } from '@/shared/utils/format'
import { Button } from '@/shared/components/Button'
import { Input } from '@/shared/components/Input'
import { buildPrompt, platformFiles, varsText, type PromptContext, type PromptScope } from './prompt'
import { CopyBlock, guessWorkerName, Note, Section, type Integration, type SiteDetail } from './ui'

type CheckReason = 'ok' | 'unreachable' | 'not_found' | 'html' | 'redirect' | 'bad_key' | 'wrong_site' | 'server_error' | 'unexpected'
interface CheckStep { ok: boolean; status: number | null; reason: CheckReason }
interface CheckResult { host: string; script: CheckStep; collect: CheckStep; lead?: CheckStep }

export function SiteConnect({ site, siteKey, onRotate, rotating, onGoFeatures }: {
  site: SiteDetail; siteKey: string | null; onRotate: () => void; rotating: boolean; onGoFeatures: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [scope, setScope] = useState<PromptScope>('full')
  const [domain, setDomain] = useState(site.domain ?? '')
  const [check, setCheck] = useState<CheckResult | null>(null)

  const { data: tpl } = useQuery({
    queryKey: ['tracking-integration'],
    queryFn: () => crmApi.get<{ data: Integration }>('/admin/tracking-sites/integration').then((r) => r.data.data),
  })
  // 表单的意向服务只能用 CRM 里已有的服务名，提示词里列出来
  const { data: services } = useQuery({
    queryKey: ['services-list'],
    queryFn: () => crmApi.get<{ data: { id: string; name: string }[] }>('/services').then((r) => r.data.data),
  })
  const checkMutation = useMutation({
    mutationFn: () => crmApi.post<{ data: CheckResult }>(`/admin/tracking-sites/${site.id}/check`, { domain }),
    onSuccess: (res) => { setCheck(res.data.data); setDomain(res.data.data.host); queryClient.invalidateQueries({ queryKey: ['tracking-site', site.id] }) },
    onError: () => setCheck(null),
  })

  if (!site.platform) {
    return <Note tone="amber">{t('siteConnect.needPlatform')} <button type="button" className="font-medium underline" onClick={onGoFeatures}>{t('siteConnect.goFeatures')}</button></Note>
  }
  if (site.platform === 'static') {
    return <Note tone="amber">{t('siteConnect.features.staticNotice')} <button type="button" className="font-medium underline" onClick={onGoFeatures}>{t('siteConnect.goFeatures')}</button></Note>
  }
  if (!tpl) return <p className="text-sm text-gray-400">{t('common.loading')}</p>

  const ctx: PromptContext = {
    t, tpl, platform: site.platform, features: site.features, siteName: site.name,
    origin: window.location.origin, workerName: guessWorkerName(), services: (services ?? []).map((s) => s.name),
  }
  const prompt = buildPrompt(ctx, scope)
  const files = site.platform === 'other' ? [] : platformFiles(ctx)
  const reasonText = (s: CheckStep) => t(`analytics.guide.verify.reasons.${s.reason}`, { status: s.status ?? '' })
  const rows = (['script', 'collect', 'lead'] as const).filter((k) => k !== 'lead' || site.features.forms)

  return (
    <div className="space-y-4">
      {/* 交给 AI 的提示词 */}
      <Section title={t('siteConnect.promptTitle')}
        aside={site.features.forms ? (
          <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5 text-xs">
            {(['full', 'forms'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setScope(s)}
                className={`rounded px-2 py-1 ${scope === s ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-500'}`}>{t(`siteConnect.scope.${s}`)}</button>
            ))}
          </div>
        ) : undefined}>
        <p className="text-xs text-gray-500">{t(scope === 'full' ? 'siteConnect.promptHint' : 'siteConnect.promptFormsHint')}</p>
        <CopyBlock code={prompt} tall />
        <Note>{t('siteConnect.promptKeyNote')}</Note>
      </Section>

      {/* 需要设置的配置 + 站点密钥 */}
      <Section title={t('siteConnect.manual.vars')}>
        <p className="whitespace-pre-line">{varsText(ctx)}</p>
        {siteKey ? <CopyBlock label="CRM_SITE_KEY" code={siteKey} /> : (
          <Note>
            {t('analytics.guide.secrets.keyHidden')}
            <Button size="sm" variant="secondary" className="ml-2" loading={rotating}
              onClick={() => { if (confirm(t('analytics.sites.rotateConfirm', { name: site.name }))) onRotate() }}>{t('analytics.guide.secrets.rotate')}</Button>
          </Note>
        )}
      </Section>

      {/* 手动接入：代码与脚本 */}
      <Section title={t('siteConnect.manual.code')}>
        {site.platform === 'other' ? <CopyBlock label={t('siteConnect.proxySpec')} code={tpl.proxySpec} tall /> : (
          <>
            <p className="whitespace-pre-line text-xs text-gray-600">{t(`siteConnect.steps.${site.platform}`, { entry: tpl.workerEntryLine })}</p>
            {files.map((f) => <CopyBlock key={f.path} label={f.path} code={f.code} />)}
          </>
        )}
        <CopyBlock label={t('analytics.guide.script.place')} code={tpl.scriptTag} />
        {site.features.forms && <CopyBlock label={t('analytics.guide.form.htmlLabel')} code={tpl.formHtml} />}
      </Section>

      {/* 检测 */}
      <Section title={t('siteConnect.manual.check')}>
        {!site.isActive && <Note tone="red">{t('analytics.guide.verify.disabled')}</Note>}
        <div className="flex items-end gap-2">
          <div className="flex-1"><Input placeholder="www.example.com" value={domain} onChange={(e) => setDomain(e.target.value)} /></div>
          <Button loading={checkMutation.isPending} disabled={!domain.trim()} onClick={() => checkMutation.mutate()}>{t('analytics.guide.verify.check')}</Button>
        </div>
        <p className="text-xs text-gray-500">{t('analytics.guide.verify.checkHint')}</p>
        {checkMutation.isError && <Note tone="red">{(checkMutation.error as { response?: { data?: { message?: string } } }).response?.data?.message ?? t('common.opFailed')}</Note>}
        {check && (
          <div className="divide-y rounded-lg border">
            {rows.map((k) => check[k] && (
              <div key={k} className="flex gap-3 px-3 py-2">
                <span className={`mt-0.5 text-sm ${check[k]!.ok ? 'text-green-600' : 'text-red-500'}`}>{check[k]!.ok ? '✓' : '✗'}</span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-800">{t(`analytics.guide.verify.rows.${k}`)}</p>
                  <p className="text-xs text-gray-500">{reasonText(check[k]!)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {check && rows.every((k) => check[k]?.ok) && <Note tone="green">{t('analytics.guide.verify.allOk')}</Note>}
        {site.lastSeenAt
          ? <Note tone="green">{t('analytics.guide.verify.liveReceived', { time: formatDate(site.lastSeenAt), count: site.visitorCount })}</Note>
          : <Note><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />{t('analytics.guide.verify.liveWaiting')}</Note>}
      </Section>
    </div>
  )
}
