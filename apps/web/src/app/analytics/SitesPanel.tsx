// 站点管理（管理员）：新建站点、接入向导、停用、更换密钥
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { crmApi } from '@/shared/utils/request'
import { formatDate } from '@/shared/utils/format'
import { Button } from '@/shared/components/Button'
import { Input } from '@/shared/components/Input'
import { Modal } from '@/shared/components/Modal'
import { isStale, Stat } from '@/app/sites/ui'

interface Site {
  id: string; name: string; domain: string | null; keyPrefix: string; isActive: boolean
  createdAt: string; lastSeenAt: string | null; visitorCount: number
  visitorsDay?: number; leadsDay?: number; blockedDay?: number; openFailures?: number
}
export function SitesPanel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', domain: '' })
  const navigate = useNavigate()
  // 站点详情页：新建或更换密钥后带上明文密钥（只显示一次）
  const openSite = (id: string, tab: string, key?: string) => navigate(`/app/ai-access/sites/${id}?tab=${tab}`, key ? { state: { key } } : undefined)

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
      openSite(d.id, 'features', d.key)
    },
  })
  const toggleMutation = useMutation({
    mutationFn: (s: Site) => crmApi.patch(`/admin/tracking-sites/${s.id}`, { isActive: !s.isActive }),
    onSuccess: refresh,
  })
  const rotateMutation = useMutation({
    mutationFn: (s: Site) => crmApi.post<{ data: { key: string } }>(`/admin/tracking-sites/${s.id}/rotate-key`, {}),
    onSuccess: (res, s) => { refresh(); openSite(s.id, 'connect', res.data.data.key) },
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
                  <Link to={`/app/ai-access/sites/${s.id}`} className="hover:text-primary-600 hover:underline">{s.name}</Link>
                  {!s.isActive && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{t('analytics.sites.disabled')}</span>}
                </p>
                <p className="mt-0.5 text-xs text-gray-400">
                  {s.domain ?? '—'} · <span className="font-mono">{s.keyPrefix}…</span> · {t('analytics.sites.visitors', { count: s.visitorCount })} ·{' '}
                  {s.lastSeenAt ? t('analytics.sites.lastSeen', { time: formatDate(s.lastSeenAt) }) : t('analytics.sites.noData')}
                </p>
                {/* 近 24 小时接入状态 */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <Stat label={t('analytics.sites.stat.visitors')} value={s.visitorsDay ?? 0} />
                  <Stat label={t('analytics.sites.stat.leads')} value={s.leadsDay ?? 0} tone={(s.leadsDay ?? 0) > 0 ? 'green' : 'gray'} />
                  <button type="button" onClick={() => openSite(s.id, 'records')} className="hover:opacity-80">
                    <Stat label={t('analytics.sites.stat.blocked')} value={s.blockedDay ?? 0} tone={(s.blockedDay ?? 0) > 0 ? 'amber' : 'gray'} />
                  </button>
                  {(s.openFailures ?? 0) > 0 && <Stat label={t('analytics.sites.stat.failures')} value={s.openFailures ?? 0} tone="red" />}
                  {s.isActive && isStale(s.lastSeenAt) && (
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">{s.lastSeenAt ? t('analytics.sites.stale') : t('analytics.sites.neverSeen')}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <button className="text-primary-600 hover:text-primary-800" onClick={() => openSite(s.id, 'connect')}>{t('analytics.sites.viewCode')}</button>
                <button className="text-gray-600 hover:text-gray-800" onClick={() => { if (confirm(t('analytics.sites.rotateConfirm', { name: s.name }))) rotateMutation.mutate(s) }}>{t('analytics.sites.rotate')}</button>
                <button className={s.isActive ? 'text-red-500 hover:text-red-700' : 'text-green-600 hover:text-green-800'} onClick={() => toggleMutation.mutate(s)}>
                  {s.isActive ? t('analytics.sites.disable') : t('analytics.sites.enable')}
                </button>
              </div>
            </li>
          ))}
        </ul>
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
