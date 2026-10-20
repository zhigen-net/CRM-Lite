// 站点详情：概览（接入状态 + 站点设置：名称、域名、部署平台、功能、启停）、接入（提示词与检测）、记录（表单提交与失败）
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { crmApi } from '@/shared/utils/request'
import { formatDate } from '@/shared/utils/format'
import { Button } from '@/shared/components/Button'
import { Input } from '@/shared/components/Input'
import { ApiFailuresPanel } from '@/app/ai-access/ApiFailuresPanel'
import { SiteConnect } from './SiteConnect'
import {
  CopyBlock, isCloudflare, isStale, Note, PLATFORM_GROUPS, Section, Stat,
  type Platform, type SiteDetail, type SiteFeatures,
} from './ui'

const TABS = ['overview', 'connect', 'records'] as const
type Tab = typeof TABS[number]

interface Submission { id: string; status: string; createdAt: string; leadId: string | null; leadName: string | null }
interface DetectResult { host: string; reachable: boolean; platform: Platform | null; evidence: string[]; behindCloudflare: boolean }

export default function SiteDetailPage() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  // 新建或更换密钥后，明文密钥只在这里显示一次
  const [siteKey, setSiteKey] = useState<string | null>((location.state as { key?: string } | null)?.key ?? null)

  const { data: site, isLoading } = useQuery({
    queryKey: ['tracking-site', id],
    queryFn: () => crmApi.get<{ data: SiteDetail }>(`/admin/tracking-sites/${id}`).then((r) => r.data.data),
    refetchInterval: 15_000,
  })
  // 旧的 ?tab=features 并入概览
  const tabParam = searchParams.get('tab')
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? '') ? tabParam as Tab : 'overview'

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['tracking-site', id] })
    queryClient.invalidateQueries({ queryKey: ['tracking-sites-admin'] })
  }
  const rotate = useMutation({
    mutationFn: () => crmApi.post<{ data: { key: string } }>(`/admin/tracking-sites/${id}/rotate-key`, {}),
    onSuccess: (res) => { setSiteKey(res.data.data.key); refresh() },
  })
  const toggle = useMutation({
    mutationFn: () => crmApi.patch(`/admin/tracking-sites/${id}`, { isActive: !site?.isActive }),
    onSuccess: refresh,
  })

  if (isLoading || !site) return <div className="p-6 text-sm text-gray-400">{t('common.loading')}</div>

  return (
    <div className="p-4 sm:p-6">
      <div className="max-w-4xl space-y-4">
        <button type="button" onClick={() => navigate('/app/ai-access?tab=sites')} className="text-sm text-gray-500 hover:text-gray-700">← {t('siteConnect.back')}</button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-semibold text-gray-900 sm:text-xl">
              {site.name}
              {!site.isActive && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-normal text-gray-500">{t('analytics.sites.disabled')}</span>}
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {site.domain ?? '—'} · <span className="font-mono">{site.keyPrefix}…</span>
              {site.platform && <> · {t(`siteConnect.platforms.${site.platform}.name`)}</>}
            </p>
          </div>
        </div>

        {siteKey && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="mb-2 text-xs text-amber-800">{t('siteConnect.keyNotice')}</p>
            <CopyBlock label="CRM_SITE_KEY" code={siteKey} />
          </div>
        )}

        <div className="flex gap-1 overflow-x-auto border-b">
          {TABS.map((k) => (
            <button key={k} type="button" onClick={() => setSearchParams({ tab: k })}
              className={`-mb-px flex-none border-b-2 px-4 py-2 text-sm font-medium ${tab === k ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t(`siteConnect.tabs.${k}`)}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="space-y-4">
            <Overview site={site} />
            <Settings site={site} onSaved={refresh} onGoConnect={() => setSearchParams({ tab: 'connect' })}
              onToggle={() => toggle.mutate()} toggling={toggle.isPending}
              onRotate={() => { if (confirm(t('analytics.sites.rotateConfirm', { name: site.name }))) rotate.mutate() }} rotating={rotate.isPending} />
          </div>
        )}
        {tab === 'connect' && <SiteConnect site={site} siteKey={siteKey} onRotate={() => rotate.mutate()} rotating={rotate.isPending} onGoFeatures={() => setSearchParams({ tab: 'overview' })} />}
        {tab === 'records' && <Records site={site} />}
      </div>
    </div>
  )
}

function Overview({ site }: { site: SiteDetail }) {
  const { t } = useTranslation()
  return (
    <Section title={t('siteConnect.overview.status')}>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Stat label={t('analytics.sites.stat.visitors')} value={site.visitorsDay ?? 0} />
        <Stat label={t('analytics.sites.stat.leads')} value={site.leadsDay ?? 0} tone={(site.leadsDay ?? 0) > 0 ? 'green' : 'gray'} />
        <Stat label={t('analytics.sites.stat.blocked')} value={site.blockedDay ?? 0} tone={(site.blockedDay ?? 0) > 0 ? 'amber' : 'gray'} />
        {(site.openFailures ?? 0) > 0 && <Stat label={t('analytics.sites.stat.failures')} value={site.openFailures ?? 0} tone="red" />}
        <span className="text-gray-500">
          {site.lastSeenAt ? t('analytics.sites.lastSeen', { time: formatDate(site.lastSeenAt) }) : t('analytics.sites.noData')}
          {' · '}{t('analytics.sites.visitors', { count: site.visitorCount })}
        </span>
      </div>
      {site.isActive && isStale(site.lastSeenAt) && <Note tone="amber">{site.lastSeenAt ? t('analytics.sites.stale') : t('analytics.sites.neverSeen')}</Note>}
    </Section>
  )
}

/** 一行设置：左侧标题与说明，右侧控件 */
function Row({ label, hint, children }: { label: string; hint?: string | undefined; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0 sm:w-48 sm:flex-none">
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function Toggle({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${on ? 'bg-primary-600' : 'bg-gray-200'} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

const selectCls = 'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

function Settings({ site, onSaved, onGoConnect, onToggle, toggling, onRotate, rotating }: {
  site: SiteDetail; onSaved: () => void; onGoConnect: () => void
  onToggle: () => void; toggling: boolean; onRotate: () => void; rotating: boolean
}) {
  const { t } = useTranslation()
  const [name, setName] = useState(site.name)
  const [domain, setDomain] = useState(site.domain ?? '')
  const [platform, setPlatform] = useState<Platform | null>(site.platform)
  const [features, setFeatures] = useState<SiteFeatures>(site.features)
  const [detected, setDetected] = useState<DetectResult | null>(null)
  useEffect(() => {
    setName(site.name); setDomain(site.domain ?? ''); setPlatform(site.platform); setFeatures(site.features)
  }, [site.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = name.trim() !== site.name || (domain.trim() || null) !== site.domain || platform !== site.platform
    || features.forms !== site.features.forms || features.connect !== site.features.connect

  const detect = useMutation({
    mutationFn: () => crmApi.post<{ data: DetectResult }>('/admin/tracking-sites/detect', { domain }).then((r) => r.data.data),
    onSuccess: (r) => { setDetected(r); setDomain(r.host); if (r.platform && !platform) setPlatform(r.platform) },
  })
  const save = useMutation({
    mutationFn: () => crmApi.patch(`/admin/tracking-sites/${site.id}`, {
      name: name.trim(), domain: domain.trim() || null, platform, features,
    }),
    onSuccess: onSaved,
  })

  return (
    <Section title={t('siteConnect.settings.title')}
      aside={site.platform ? <Button size="sm" variant="secondary" onClick={onGoConnect}>{t('siteConnect.overview.goConnect')}</Button> : undefined}>
      <div className="divide-y">
        <Row label={t('analytics.sites.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Row>
        <Row label={t('siteConnect.settings.domain')} hint={t('siteConnect.settings.domainHint')}>
          <div className="flex gap-2">
            <div className="flex-1"><Input placeholder="www.example.com" value={domain} onChange={(e) => setDomain(e.target.value)} /></div>
            <Button variant="secondary" loading={detect.isPending} disabled={!domain.trim()} onClick={() => detect.mutate()}>{t('siteConnect.features.detect')}</Button>
          </div>
          {detect.isError && <p className="mt-1 text-xs text-red-600">{(detect.error as { response?: { data?: { message?: string } } }).response?.data?.message ?? t('common.opFailed')}</p>}
          {detected && (
            <p className={`mt-1 text-xs ${detected.platform ? 'text-green-700' : 'text-amber-700'}`}>
              {!detected.reachable ? t('siteConnect.features.detectUnreachable')
                : detected.platform ? <>
                  {t('siteConnect.features.detected', { name: t(`siteConnect.platforms.${detected.platform}.name`) })}
                  <span className="text-gray-500">（{detected.evidence.join('；')}）</span>
                  {detected.platform !== platform && <button type="button" className="ml-1 font-medium underline" onClick={() => setPlatform(detected.platform)}>{t('siteConnect.features.useDetected')}</button>}
                </> : t('siteConnect.features.detectUnknown')}
            </p>
          )}
        </Row>
        <Row label={t('siteConnect.features.platform')}>
          <select className={selectCls} value={platform ?? ''} onChange={(e) => setPlatform((e.target.value || null) as Platform | null)}>
            <option value="">{t('siteConnect.settings.choosePlatform')}</option>
            {PLATFORM_GROUPS.map((g) => (
              <optgroup key={g.key} label={t(`siteConnect.groups.${g.key}`)}>
                {g.items.map((p) => <option key={p} value={p}>{t(`siteConnect.platforms.${p}.name`)}</option>)}
              </optgroup>
            ))}
          </select>
          {platform && <p className="mt-1 text-xs text-gray-500">{t(`siteConnect.platforms.${platform}.hint`)}</p>}
          {platform === 'static' && <p className="mt-1 text-xs text-amber-700">{t('siteConnect.features.staticNotice')}</p>}
          {isCloudflare(platform) && (
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              {(['binding', 'url'] as const).map((m) => (
                <label key={m} className="flex cursor-pointer items-center gap-1.5" title={t(`siteConnect.connectHint.${m}`)}>
                  <input type="radio" checked={features.connect === m} onChange={() => setFeatures({ ...features, connect: m })} />
                  {t(`siteConnect.connect.${m}`)}
                </label>
              ))}
            </div>
          )}
        </Row>
        <Row label={t('siteConnect.features.tracking')} hint={t('siteConnect.features.trackingHint')}><Toggle on disabled /></Row>
        <Row label={t('siteConnect.features.forms')} hint={t('siteConnect.features.formsHint')}>
          <Toggle on={features.forms} onClick={() => setFeatures({ ...features, forms: !features.forms })} />
        </Row>
        <Row label={t('siteConnect.features.widgets')} hint={t('siteConnect.features.widgetsHint')}>
          <span className="flex items-center gap-2"><Toggle on={false} disabled /><span className="text-xs text-gray-400">{t('siteConnect.features.soon')}</span></span>
        </Row>
        <Row label={t('siteConnect.settings.status')} hint={t(site.isActive ? 'siteConnect.settings.activeHint' : 'siteConnect.settings.inactiveHint')}>
          <div className="flex flex-wrap items-center gap-2">
            <Toggle on={site.isActive} disabled={toggling} onClick={onToggle} />
            <span className="text-sm text-gray-600">{site.isActive ? t('siteConnect.settings.active') : t('analytics.sites.disabled')}</span>
          </div>
        </Row>
        <Row label={t('siteConnect.settings.key')} hint={t('siteConnect.settings.keyHint')}>
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-gray-600">{site.keyPrefix}…</span>
            <Button size="sm" variant="secondary" loading={rotating} onClick={onRotate}>{t('analytics.sites.rotate')}</Button>
          </div>
        </Row>
      </div>
      <div className="flex justify-end gap-2 border-t pt-3">
        <Button disabled={!dirty || !name.trim()} loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>
      </div>
    </Section>
  )
}

function Records({ site }: { site: SiteDetail }) {
  const { t } = useTranslation()
  const { data, isLoading } = useQuery({
    queryKey: ['site-submissions', site.id],
    queryFn: () => crmApi.get<{ data: Submission[] }>(`/admin/tracking-sites/${site.id}/submissions`).then((r) => r.data.data),
  })
  return (
    <div className="space-y-4">
      <Section title={t('siteConnect.records.submissions')}>
        <p className="text-xs text-gray-500">{t('analytics.sites.submissions.hint')}</p>
        {isLoading ? <p className="text-gray-400">{t('common.loading')}</p> : !data?.length ? (
          <p className="py-4 text-center text-gray-400">{t('analytics.sites.submissions.empty')}</p>
        ) : (
          <ul className="divide-y">
            {data.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-xs text-gray-500">{formatDate(x.createdAt)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {x.leadId ? <Link to={`/app/leads/${x.leadId}`} className="text-primary-600 hover:underline">{x.leadName ?? x.leadId}</Link> : <span className="text-gray-400">—</span>}
                </span>
                <span className={`rounded px-1.5 py-0.5 text-xs ${x.status === 'ok' ? 'bg-green-50 text-green-700' : x.status === 'error' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                  {t(`analytics.sites.submissions.status.${x.status}`, { defaultValue: x.status })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <ApiFailuresPanel source="site" siteId={site.id} />
    </div>
  )
}
