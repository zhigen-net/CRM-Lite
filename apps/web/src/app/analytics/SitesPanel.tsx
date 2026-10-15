// 站点管理（管理员）：新建站点、查看接入代码、停用、更换密钥
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { crmApi } from '@/shared/utils/request'
import { formatDate } from '@/shared/utils/format'
import { Button } from '@/shared/components/Button'
import { Input } from '@/shared/components/Input'
import { Modal } from '@/shared/components/Modal'

interface Site {
  id: string; name: string; domain: string | null; keyPrefix: string; isActive: boolean
  createdAt: string; lastSeenAt: string | null; visitorCount: number
}
interface Integration { pagesFunction: string; workerSnippet: string; scriptTag: string }

function CopyBlock({ label, code }: { label: string; code: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => {})}>
          {copied ? t('profile.api.copied') : t('profile.api.copy')}
        </Button>
      </div>
      <pre className="max-h-56 overflow-auto whitespace-pre rounded border bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700">{code}</pre>
    </div>
  )
}

/** 接入说明弹窗：新建或更换密钥后带明文密钥；从列表打开时不显示密钥 */
function IntegrationDialog({ site, siteKey, onClose }: { site: { id: string; name: string }; siteKey: string | null; onClose: () => void }) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'pages' | 'worker'>('pages')
  const { data } = useQuery({
    queryKey: ['tracking-integration'],
    queryFn: () => crmApi.get<{ data: Integration }>('/admin/tracking-sites/integration').then((r) => r.data.data),
  })
  const aiPrompt = data ? t('analytics.sites.aiPrompt', {
    mode: t(`analytics.sites.modes.${mode}`),
    code: mode === 'pages' ? data.pagesFunction : data.workerSnippet,
    scriptTag: data.scriptTag,
  }) : ''

  return (
    <Modal title={t('analytics.sites.integrationTitle', { name: site.name })} onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose}>{siteKey ? t('profile.api.dismiss') : t('common.close')}</Button>}>
      <div className="space-y-4 text-sm">
        {siteKey ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="mb-2 text-xs font-medium text-amber-800">{t('analytics.sites.keyNotice')}</p>
            <CopyBlock label="CRM_SITE_KEY" code={siteKey} />
          </div>
        ) : (
          <p className="rounded border bg-gray-50 px-3 py-2 text-xs text-gray-500">{t('analytics.sites.keyHidden')}</p>
        )}
        <ol className="list-decimal space-y-1 pl-5 text-xs text-gray-600">
          <li>{t('analytics.sites.step1')}</li>
          <li>{t('analytics.sites.step2')}</li>
          <li>{t('analytics.sites.step3')}</li>
        </ol>
        <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-gray-100 p-1">
          {(['pages', 'worker'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={`rounded px-2 py-1.5 text-xs ${mode === m ? 'bg-white font-medium text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              {t(`analytics.sites.modes.${m}`)}
            </button>
          ))}
        </div>
        {data && (
          <>
            <CopyBlock label={t(`analytics.sites.codeLabel.${mode}`)} code={mode === 'pages' ? data.pagesFunction : data.workerSnippet} />
            <CopyBlock label={t('analytics.sites.scriptLabel')} code={data.scriptTag} />
            <CopyBlock label={t('analytics.sites.aiPromptLabel')} code={aiPrompt} />
          </>
        )}
        <p className="text-xs text-gray-400">{t('analytics.sites.bindingHint')}</p>
      </div>
    </Modal>
  )
}

export function SitesPanel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', domain: '' })
  const [dialog, setDialog] = useState<{ site: { id: string; name: string }; key: string | null } | null>(null)

  const { data: sites, isLoading } = useQuery({
    queryKey: ['tracking-sites-admin'],
    queryFn: () => crmApi.get<{ data: Site[] }>('/admin/tracking-sites').then((r) => r.data.data),
  })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['tracking-sites-admin'] })
    queryClient.invalidateQueries({ queryKey: ['tracking-sites'] })
  }

  const createMutation = useMutation({
    mutationFn: () => crmApi.post<{ data: { id: string; name: string; key: string } }>('/admin/tracking-sites', { name: form.name, domain: form.domain || null }),
    onSuccess: (res) => { refresh(); setCreating(false); setForm({ name: '', domain: '' }); setDialog({ site: res.data.data, key: res.data.data.key }) },
  })
  const toggleMutation = useMutation({
    mutationFn: (s: Site) => crmApi.patch(`/admin/tracking-sites/${s.id}`, { isActive: !s.isActive }),
    onSuccess: refresh,
  })
  const rotateMutation = useMutation({
    mutationFn: (s: Site) => crmApi.post<{ data: { key: string } }>(`/admin/tracking-sites/${s.id}/rotate-key`, {}),
    onSuccess: (res, s) => { refresh(); setDialog({ site: s, key: res.data.data.key }) },
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
                  {s.name}
                  {!s.isActive && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">{t('analytics.sites.disabled')}</span>}
                </p>
                <p className="mt-0.5 text-xs text-gray-400">
                  {s.domain ?? '—'} · <span className="font-mono">{s.keyPrefix}…</span> · {t('analytics.sites.visitors', { count: s.visitorCount })} ·{' '}
                  {s.lastSeenAt ? t('analytics.sites.lastSeen', { time: formatDate(s.lastSeenAt) }) : t('analytics.sites.noData')}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <button className="text-primary-600 hover:text-primary-800" onClick={() => setDialog({ site: s, key: null })}>{t('analytics.sites.viewCode')}</button>
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
      {dialog && <IntegrationDialog site={dialog.site} siteKey={dialog.key} onClose={() => setDialog(null)} />}
    </div>
  )
}
