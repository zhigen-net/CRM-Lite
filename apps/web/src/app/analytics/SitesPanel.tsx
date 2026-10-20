// 站点管理（管理员）：站点列表与接入状态；概览、接入、记录进入站点详情，停用/启用直接操作
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { crmApi } from '@/shared/utils/request'
import { formatDate } from '@/shared/utils/format'
import { Button } from '@/shared/components/Button'
import { Input } from '@/shared/components/Input'
import { Modal } from '@/shared/components/Modal'
import { isStale, Stat, type Platform, type SiteFeatures } from '@/app/sites/ui'
import { SiteDrawer, toSiteTab, type SiteTab } from '@/app/sites/SiteDrawer'

interface Site {
  id: string; name: string; domain: string | null; keyPrefix: string; isActive: boolean
  createdAt: string; lastSeenAt: string | null; visitorCount: number
  visitorsDay?: number; leadsDay?: number; blockedDay?: number; openFailures?: number
  platform?: Platform | null; features?: SiteFeatures
}
export function SitesPanel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', domain: '' })
  // 站点详情抽屉：打开的站点和标签记在地址里（?site=&view=），刷新或分享链接后仍能打开
  const [searchParams, setSearchParams] = useSearchParams()
  const openId = searchParams.get('site')
  const view = toSiteTab(searchParams.get('view'))
  // 新建站点后的明文密钥只在抽屉里显示一次
  const [newKey, setNewKey] = useState<{ id: string; key: string } | null>(null)
  const openSite = (id: string, tab: SiteTab, key?: string) => {
    setNewKey(key ? { id, key } : null)
    setSearchParams((p) => { p.set('site', id); p.set('view', tab); return p })
  }
  const closeSite = () => { setNewKey(null); setSearchParams((p) => { p.delete('site'); p.delete('view'); return p }) }

  const { data: sites, isLoading } = useQuery({
    queryKey: ['tracking-sites-admin'],
    queryFn: () => crmApi.get<{ data: Site[] }>('/admin/tracking-sites').then((r) => r.data.data),
  })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['tracking-sites-admin'] })
    queryClient.invalidateQueries({ queryKey: ['tracking-sites'] })
  }

  const createMutation = useMutation({
    mutationFn: () => crmApi.post<{ data: { id: string; name: string; key: string; keyPrefix: string } }>('/admin/tracking-sites', { name: form.name, domain: form.domain || null }),
    onSuccess: (res) => {
      refresh(); setCreating(false); setForm({ name: '', domain: '' })
      const d = res.data.data
      openSite(d.id, 'overview', d.key)
    },
  })
  const toggleMutation = useMutation({
    mutationFn: (s: Site) => crmApi.patch(`/admin/tracking-sites/${s.id}`, { isActive: !s.isActive }),
    onSuccess: refresh,
  })

  return (
    <div className="overflow-hidden rounded-lg border bg-white">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-medium text-gray-900">{t('analytics.sites.title')}</h2>
          <p className="mt-0.5 text-xs text-gray-500">{t('analytics.sites.subtitle')}</p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>{t('analytics.sites.create')}</Button>
      </div>
      {isLoading ? (
        <div className="px-4 py-6 text-sm text-gray-400">{t('common.loading')}</div>
      ) : !sites?.length ? (
        <div className="px-4 py-8 text-center text-sm text-gray-400">{t('analytics.sites.empty')}</div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {sites.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900">
                  <button type="button" onClick={() => openSite(s.id, 'overview')} className="text-left hover:text-primary-600 hover:underline">{s.name}</button>
                  {!s.isActive && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{t('analytics.sites.disabled')}</span>}
                </p>
                <p className="mt-0.5 text-xs text-gray-400">
                  {s.domain ?? '—'} ·{' '}
                  {s.platform
                    ? t(`siteConnect.platforms.${s.platform}.name`)
                    : <button type="button" className="text-amber-600 hover:underline" onClick={() => openSite(s.id, 'overview')}>{t('analytics.sites.noPlatform')}</button>}
                  {' '}· {t(s.features?.forms ? 'analytics.sites.withForms' : 'analytics.sites.trackingOnly')}
                  {' '}· <span className="font-mono">{s.keyPrefix}…</span> · {t('analytics.sites.visitors', { count: s.visitorCount })} ·{' '}
                  {s.lastSeenAt ? t('analytics.sites.lastSeen', { time: formatDate(s.lastSeenAt) }) : t('analytics.sites.noData')}
                </p>
                {/* 近 24 小时接入状态 */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <Stat label={t('analytics.sites.stat.visitors')} value={s.visitorsDay ?? 0} />
                  <Stat label={t('analytics.sites.stat.leads')} value={s.leadsDay ?? 0} tone={(s.leadsDay ?? 0) > 0 ? 'green' : 'gray'} />
                  <button type="button" onClick={() => openSite(s.id, 'records')} className="hover:opacity-80">
                    <Stat label={t('analytics.sites.stat.blocked')} value={s.blockedDay ?? 0} tone={(s.blockedDay ?? 0) > 0 ? 'amber' : 'gray'} />
                  </button>
                  {(s.openFailures ?? 0) > 0 && (
                    <button type="button" onClick={() => openSite(s.id, 'records')} className="hover:opacity-80">
                      <Stat label={t('analytics.sites.stat.failures')} value={s.openFailures ?? 0} tone="red" />
                    </button>
                  )}
                  {s.isActive && isStale(s.lastSeenAt) && (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">{s.lastSeenAt ? t('analytics.sites.stale') : t('analytics.sites.neverSeen')}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs">
                {(['overview', 'connect', 'records'] as const).map((tab) => (
                  <button key={tab} type="button" className="text-primary-600 hover:text-primary-800" onClick={() => openSite(s.id, tab)}>{t(`siteConnect.tabs.${tab}`)}</button>
                ))}
                <span className="h-3 w-px bg-gray-200" />
                <button type="button" disabled={toggleMutation.isPending} className={s.isActive ? 'text-red-500 hover:text-red-700' : 'text-green-600 hover:text-green-800'}
                  onClick={() => { if (!s.isActive || confirm(t('analytics.sites.disableConfirm', { name: s.name }))) toggleMutation.mutate(s) }}>
                  {s.isActive ? t('analytics.sites.disable') : t('analytics.sites.enable')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {openId && (
        <SiteDrawer key={openId} id={openId} tab={view} initialKey={newKey?.id === openId ? newKey.key : null}
          onTab={(tab) => setSearchParams((p) => { p.set('view', tab); return p }, { replace: true })} onClose={closeSite} />
      )}

      {creating && (
        <Modal title={t('analytics.sites.create')} onClose={() => setCreating(false)}
          footer={<>
            <Button variant="secondary" onClick={() => setCreating(false)}>{t('common.cancel')}</Button>
            <Button loading={createMutation.isPending} disabled={!form.name.trim()} onClick={() => createMutation.mutate()}>{t('analytics.sites.create')}</Button>
          </>}>
          <div className="space-y-3">
            <Input label={t('analytics.sites.name')} placeholder={t('analytics.sites.namePlaceholder')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input label={t('analytics.sites.domain')} placeholder="www.example.com" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} />
          </div>
        </Modal>
      )}
    </div>
  )
}
