// 站点详情：概览（接入状态）、功能（部署平台与功能开关）、接入（提示词与检测）、记录（表单提交与失败）
import { useEffect, useState } from 'react'
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

const TABS = ['overview', 'features', 'connect', 'records'] as const
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
  const tabParam = searchParams.get('tab') as Tab | null
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : site && !site.platform ? 'features' : 'overview'

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
          <div className="flex items-center gap-3 text-sm">
            <button className="text-gray-600 hover:text-gray-900" onClick={() => { if (confirm(t('analytics.sites.rotateConfirm', { name: site.name }))) rotate.mutate() }}>{t('analytics.sites.rotate')}</button>
            <button className={site.isActive ? 'text-red-500 hover:text-red-700' : 'text-green-600 hover:text-green-800'} onClick={() => toggle.mutate()}>
              {site.isActive ? t('analytics.sites.disable') : t('analytics.sites.enable')}
            </button>
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

        {tab === 'overview' && <Overview site={site} onGo={(k) => setSearchParams({ tab: k })} />}
        {tab === 'features' && <Features site={site} onSaved={() => { refresh(); setSearchParams({ tab: 'connect' }) }} />}
        {tab === 'connect' && <SiteConnect site={site} siteKey={siteKey} onRotate={() => rotate.mutate()} rotating={rotate.isPending} onGoFeatures={() => setSearchParams({ tab: 'features' })} />}
        {tab === 'records' && <Records site={site} />}
      </div>
    </div>
  )
}

function Overview({ site, onGo }: { site: SiteDetail; onGo: (tab: Tab) => void }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <Section title={t('siteConnect.overview.status')}>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Stat label={t('analytics.sites.stat.visitors')} value={site.visitorsDay ?? 0} />
          <Stat label={t('analytics.sites.stat.leads')} value={site.leadsDay ?? 0} tone={(site.leadsDay ?? 0) > 0 ? 'green' : 'gray'} />
          <Stat label={t('analytics.sites.stat.blocked')} value={site.blockedDay ?? 0} tone={(site.blockedDay ?? 0) > 0 ? 'amber' : 'gray'} />
          {(site.openFailures ?? 0) > 0 && <Stat label={t('analytics.sites.stat.failures')} value={site.openFailures ?? 0} tone="red" />}
        </div>
        <p className="text-xs text-gray-500">
          {site.lastSeenAt ? t('analytics.sites.lastSeen', { time: formatDate(site.lastSeenAt) }) : t('analytics.sites.noData')}
          {' · '}{t('analytics.sites.visitors', { count: site.visitorCount })}
        </p>
        {site.isActive && isStale(site.lastSeenAt) && <Note tone="amber">{site.lastSeenAt ? t('analytics.sites.stale') : t('analytics.sites.neverSeen')}</Note>}
      </Section>
      <Section title={t('siteConnect.overview.setup')} aside={<Button size="sm" variant="secondary" onClick={() => onGo('features')}>{t('common.edit')}</Button>}>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-gray-400">{t('siteConnect.features.platform')}</dt><dd>{site.platform ? t(`siteConnect.platforms.${site.platform}.name`) : t('siteConnect.overview.noPlatform')}</dd></div>
          <div><dt className="text-xs text-gray-400">{t('siteConnect.features.title')}</dt>
            <dd>{[t('siteConnect.features.tracking'), ...(site.features.forms ? [t('siteConnect.features.forms')] : [])].join('、')}</dd></div>
        </dl>
        <Button size="sm" onClick={() => onGo('connect')}>{t('siteConnect.overview.goConnect')}</Button>
      </Section>
    </div>
  )
}

function Features({ site, onSaved }: { site: SiteDetail; onSaved: () => void }) {
  const { t } = useTranslation()
  const [platform, setPlatform] = useState<Platform | null>(site.platform)
  const [features, setFeatures] = useState<SiteFeatures>(site.features)
  const [domain, setDomain] = useState(site.domain ?? '')
  const [detected, setDetected] = useState<DetectResult | null>(null)
  useEffect(() => { setPlatform(site.platform); setFeatures(site.features) }, [site.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const detect = useMutation({
    mutationFn: () => crmApi.post<{ data: DetectResult }>('/admin/tracking-sites/detect', { domain }).then((r) => r.data.data),
    onSuccess: (r) => { setDetected(r); setDomain(r.host) },
  })
  const save = useMutation({
    mutationFn: () => crmApi.patch(`/admin/tracking-sites/${site.id}`, { platform, features, ...(domain.trim() && domain.trim() !== site.domain ? { domain: domain.trim() } : {}) }),
    onSuccess: onSaved,
  })

  return (
    <div className="space-y-4">
      <Section title={t('siteConnect.features.platform')}>
        <p className="text-xs text-gray-500">{t('siteConnect.features.platformHint')}</p>
        <div className="flex items-end gap-2">
          <div className="flex-1"><Input placeholder="www.example.com" value={domain} onChange={(e) => setDomain(e.target.value)} /></div>
          <Button variant="secondary" loading={detect.isPending} disabled={!domain.trim()} onClick={() => detect.mutate()}>{t('siteConnect.features.detect')}</Button>
        </div>
        {detect.isError && <Note tone="red">{(detect.error as { response?: { data?: { message?: string } } }).response?.data?.message ?? t('common.opFailed')}</Note>}
        {detected && (
          <Note tone={detected.platform ? 'green' : 'amber'}>
            {!detected.reachable ? t('siteConnect.features.detectUnreachable')
              : detected.platform ? <>
                {t('siteConnect.features.detected', { name: t(`siteConnect.platforms.${detected.platform}.name`) })}
                <span className="ml-1 text-gray-500">（{detected.evidence.join('；')}）</span>
                {detected.platform !== platform && <button type="button" className="ml-2 font-medium underline" onClick={() => setPlatform(detected.platform)}>{t('siteConnect.features.useDetected')}</button>}
              </> : t('siteConnect.features.detectUnknown')}
          </Note>
        )}
        {PLATFORM_GROUPS.map((g) => (
          <div key={g.key}>
            <p className="mb-1.5 mt-2 text-xs font-medium text-gray-500">{t(`siteConnect.groups.${g.key}`)}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {g.items.map((p) => (
                <button key={p} type="button" onClick={() => setPlatform(p)}
                  className={`rounded-lg border p-3 text-left ${platform === p ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500' : 'border-gray-200 hover:border-gray-300'}`}>
                  <p className="text-sm font-medium text-gray-900">{t(`siteConnect.platforms.${p}.name`)}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{t(`siteConnect.platforms.${p}.hint`)}</p>
                </button>
              ))}
            </div>
          </div>
        ))}
        {platform === 'static' && <Note tone="amber">{t('siteConnect.features.staticNotice')}</Note>}
        {isCloudflare(platform) && (
          <div>
            <p className="mb-1.5 mt-2 text-xs font-medium text-gray-500">{t('siteConnect.features.account')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['binding', 'url'] as const).map((m) => (
                <button key={m} type="button" onClick={() => setFeatures({ ...features, connect: m })}
                  className={`rounded-lg border p-3 text-left ${features.connect === m ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500' : 'border-gray-200 hover:border-gray-300'}`}>
                  <p className="text-sm font-medium text-gray-900">{t(`siteConnect.connect.${m}`)}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{t(`siteConnect.connectHint.${m}`)}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title={t('siteConnect.features.title')}>
        {[
          { key: 'tracking', on: true, locked: true },
          { key: 'forms', on: features.forms, locked: false },
          { key: 'widgets', on: false, locked: true, soon: true },
        ].map((f) => (
          <div key={f.key} className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-800">
                {t(`siteConnect.features.${f.key}`)}
                {f.soon && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-normal text-gray-500">{t('siteConnect.features.soon')}</span>}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">{t(`siteConnect.features.${f.key}Hint`)}</p>
            </div>
            <button type="button" disabled={f.locked}
              onClick={() => f.key === 'forms' && setFeatures({ ...features, forms: !features.forms })}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${f.on ? 'bg-primary-600' : 'bg-gray-200'} ${f.locked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${f.on ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        ))}
      </Section>

      <div className="flex justify-end">
        <Button loading={save.isPending} disabled={!platform} onClick={() => save.mutate()}>{t('siteConnect.features.save')}</Button>
      </div>
    </div>
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
