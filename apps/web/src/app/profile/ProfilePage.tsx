import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { crmApi } from '@/shared/utils/request'
import { useCrmAuth } from '@/app/auth/CrmAuthContext'
import { Input } from '@/shared/components/Input'
import { Button } from '@/shared/components/Button'
import { Modal } from '@/shared/components/Modal'
import { formatDate } from '@/shared/utils/format'
import { ApiIntegrationDialog } from './ApiIntegrationDialog'

const TAB_KEYS = ['info', 'password', 'api', 'notify'] as const
type TabKey = typeof TAB_KEYS[number]

const nameSchema = z.object({
  name: z.string().min(1),
})
const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
  confirmPassword: z.string().min(1),
}).refine((d) => d.newPassword === d.confirmPassword, {
  path: ['confirmPassword'],
})
const apiKeySchema = z.object({
  name: z.string().min(1).max(50),
})

type NameForm = z.infer<typeof nameSchema>
type PasswordForm = z.infer<typeof passwordSchema>
type ApiKeyForm = z.infer<typeof apiKeySchema>

interface ApiKey {
  id: string
  name: string
  keyPrefix: string
  createdAt: string
  lastUsedAt: string | null
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

// ---- 基本信息 Tab ----
function InfoTab() {
  const { t } = useTranslation()
  const { user, updateUser } = useCrmAuth()
  const [saved, setSaved] = useState(false)
  const form = useForm<NameForm>({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: user?.name ?? '' },
  })
  const mutation = useMutation({
    mutationFn: (body: NameForm) =>
      crmApi.put<{ data: { name: string } }>('/auth/profile', body),
    onSuccess: (res) => {
      updateUser({ name: res.data.data.name })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('common.opFailed')
      form.setError('name', { message: msg })
    },
  })
  return (
    <div className="rounded-lg border bg-white p-4 sm:p-6 max-w-lg">
      <div className="mb-4 text-sm text-gray-500">
        {t('profile.basic.email')}：<span className="text-gray-700">{user?.email}</span>
        <span className="ml-3 text-gray-400">·</span>
        <span className="ml-3">{t('profile.basic.role')}：<span className="text-gray-700">{user?.role}</span></span>
      </div>
      <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-3">
        <Input
          label={t('profile.basic.displayName')}
          error={form.formState.errors.name?.message}
          {...form.register('name')}
        />
        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" size="sm" loading={mutation.isPending}>{t('profile.basic.save')}</Button>
          {saved && <span className="text-sm text-green-600">{t('common.saved')}</span>}
        </div>
      </form>
    </div>
  )
}

// ---- 修改密码 Tab ----
function PasswordTab() {
  const { t } = useTranslation()
  const [saved, setSaved] = useState(false)
  const form = useForm<PasswordForm>({ resolver: zodResolver(passwordSchema) })
  const mutation = useMutation({
    mutationFn: ({ currentPassword, newPassword }: PasswordForm) =>
      crmApi.put('/auth/profile', { currentPassword, newPassword }),
    onSuccess: () => {
      form.reset()
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('common.opFailed')
      form.setError('currentPassword', { message: msg })
    },
  })
  return (
    <div className="rounded-lg border bg-white p-4 sm:p-6 max-w-lg">
      <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-3">
        <Input label={t('profile.password.current')} type="password" autoComplete="current-password"
          error={form.formState.errors.currentPassword?.message} {...form.register('currentPassword')} />
        <Input label={t('profile.password.new')} type="password" autoComplete="new-password"
          error={form.formState.errors.newPassword?.message} {...form.register('newPassword')} />
        <Input label={t('profile.password.confirm')} type="password" autoComplete="new-password"
          error={form.formState.errors.confirmPassword?.message} {...form.register('confirmPassword')} />
        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" size="sm" loading={mutation.isPending}>{t('profile.password.submit')}</Button>
          {saved && <span className="text-sm text-green-600">{t('profile.password.changed')}</span>}
        </div>
      </form>
    </div>
  )
}

interface Service { id: string; name: string }

// ---- API 接入 Tab ----
function ApiTab() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  // 打开 AI 接入弹窗：刚生成时带完整密钥，从列表打开时 key 为空
  const [integration, setIntegration] = useState<{ name: string; key: string | null } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => crmApi.get<{ data: ApiKey[] }>('/auth/api-keys').then((r) => r.data.data),
  })

  const { data: services } = useQuery({
    queryKey: ['services-list'],
    queryFn: () => crmApi.get<{ data: Service[] }>('/services').then((r) => r.data.data),
  })

  const form = useForm<ApiKeyForm>({ resolver: zodResolver(apiKeySchema) })

  const createMutation = useMutation({
    mutationFn: (body: ApiKeyForm) =>
      crmApi.post<{ data: { id: string; name: string; keyPrefix: string; key: string } }>('/auth/api-keys', body),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      setShowCreate(false)
      form.reset()
      setIntegration({ name: res.data.data.name, key: res.data.data.key })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => crmApi.delete(`/auth/api-keys/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
  })

  const endpoint = `${API_BASE}/api/v1/leads`
  // 给 AI 的提示词需要完整地址（默认同源部署时 API_BASE 为空）
  const absoluteEndpoint = `${API_BASE || window.location.origin}/api/v1/leads`

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="rounded-lg border bg-white overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="font-medium text-gray-900 text-sm">{t('profile.api.keys')}</h2>
          <Button size="sm" onClick={() => setShowCreate(true)}>{t('profile.api.generate')}</Button>
        </div>
        {isLoading ? (
          <div className="p-4 text-sm text-gray-400">{t('common.loading')}</div>
        ) : !data?.length ? (
          <div className="p-4 text-sm text-gray-400">{t('profile.api.empty')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-700">{t('profile.api.cols.usage')}</th>
                <th className="px-4 py-2 text-left font-medium text-gray-700">{t('profile.api.cols.prefix')}</th>
                <th className="px-4 py-2 text-left font-medium text-gray-700">{t('profile.api.cols.createdAt')}</th>
                <th className="px-4 py-2 text-left font-medium text-gray-700">{t('profile.api.cols.lastUsed')}</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((k) => (
                <tr key={k.id}>
                  <td className="px-4 py-2.5 font-medium text-gray-900">{k.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{k.keyPrefix}...</td>
                  <td className="px-4 py-2.5 text-gray-500">{formatDate(k.createdAt)}</td>
                  <td className="px-4 py-2.5 text-gray-500">{k.lastUsedAt ? formatDate(k.lastUsedAt) : t('profile.api.cols.never')}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button
                      onClick={() => setIntegration({ name: k.name, key: null })}
                      className="mr-3 text-xs text-primary-600 hover:text-primary-800"
                    >
                      {t('profile.api.prompt.open')}
                    </button>
                    <button
                      onClick={() => { if (confirm(t('profile.api.revokeConfirm', { name: k.name }))) deleteMutation.mutate(k.id) }}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      {t('profile.api.revoke')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-lg border bg-white p-4 sm:p-5">
        <h2 className="font-medium text-gray-900 mb-3 text-sm">{t('profile.api.docs.title')}</h2>
        <div className="space-y-3 text-sm">
          <div>
            <p className="text-gray-500 mb-1">{t('profile.api.docs.submit')}</p>
            <code className="block rounded bg-gray-50 border px-3 py-2 text-xs font-mono text-gray-700">
              POST {endpoint}
            </code>
          </div>
          <div>
            <p className="text-gray-500 mb-1">{t('profile.api.docs.headers')}</p>
            <code className="block rounded bg-gray-50 border px-3 py-2 text-xs font-mono text-gray-700 whitespace-pre">{`Content-Type: application/json\nX-API-Key: <${t('profile.api.docs.yourApiKey')}>`}</code>
          </div>
          <div>
            <p className="text-gray-500 mb-1">{t('profile.api.docs.body')}</p>
            <code className="block rounded bg-gray-50 border px-3 py-2 text-xs font-mono text-gray-700 whitespace-pre">{t('profile.api.docs.bodyExample')}</code>
          </div>
          {services && services.length > 0 && (
            <div>
              <p className="text-gray-500 mb-1.5">{t('profile.api.docs.services')}</p>
              <div className="rounded bg-gray-50 border px-3 py-2 flex flex-wrap gap-1.5">
                {services.map((s) => (
                  <span key={s.id} className="inline-block rounded border border-gray-200 bg-white px-2 py-0.5 text-xs font-mono text-gray-700">
                    {s.name}
                  </span>
                ))}
              </div>
              <p className="mt-1 text-xs text-gray-400">{t('profile.api.docs.servicesHint')}</p>
            </div>
          )}
          <p className="text-xs text-gray-400">{t('profile.api.docs.adInfo')}</p>
          <div>
            <p className="text-gray-500 mb-1">{t('profile.api.docs.curl')}</p>
            <code className="block rounded bg-gray-50 border px-3 py-2 text-xs font-mono text-gray-700 whitespace-pre">{t('profile.api.docs.curlExample', { endpoint })}</code>
          </div>
          <div>
            <p className="text-gray-500 mb-1">{t('profile.api.docs.response')}</p>
            <code className="block rounded bg-gray-50 border px-3 py-2 text-xs font-mono text-gray-700">{`{ "data": { "id": "uuid", "status": "New" } }`}</code>
          </div>
        </div>
      </div>

      {integration && (
        <ApiIntegrationDialog
          endpoint={absoluteEndpoint}
          services={(services ?? []).map((s) => s.name)}
          apiKey={integration.key}
          keyName={integration.name}
          onClose={() => setIntegration(null)}
        />
      )}

      {showCreate && (
        <Modal
          title={t('profile.api.generate')}
          onClose={() => { setShowCreate(false); form.reset() }}
          footer={
            <>
              <Button variant="secondary" onClick={() => { setShowCreate(false); form.reset() }}>{t('common.cancel')}</Button>
              <Button loading={createMutation.isPending} onClick={form.handleSubmit((d) => createMutation.mutate(d))}>
                {t('profile.api.generate')}
              </Button>
            </>
          }
        >
          <Input
            label={t('profile.api.cols.usage')}
            placeholder={t('profile.api.namePlaceholder')}
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />
        </Modal>
      )}
    </div>
  )
}

// ---- 提醒配置 ----
const notifySchema = z.object({
  emailEnabled: z.boolean(),
  email: z.string().optional().default(''),
  webhookEnabled: z.boolean(),
  webhookUrl: z.string().optional().default(''),
})
type NotifyForm = z.infer<typeof notifySchema>

function NotifyTab() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'ok' | 'fail'>('idle')
  const [testDetail, setTestDetail] = useState<string>('')

  const { data, isLoading } = useQuery({
    queryKey: ['notification-config'],
    queryFn: () => crmApi.get<{ data: NotifyForm }>('/auth/notification-config').then((r) => r.data.data),
  })

  const form = useForm<NotifyForm>({
    resolver: zodResolver(notifySchema),
    defaultValues: { emailEnabled: false, email: '', webhookEnabled: false, webhookUrl: '' },
  })

  useEffect(() => {
    if (data) form.reset(data)
  }, [data]) // eslint-disable-line react-hooks/exhaustive-deps

  const emailEnabled = form.watch('emailEnabled')
  const webhookEnabled = form.watch('webhookEnabled')

  const saveMutation = useMutation({
    mutationFn: (body: NotifyForm) => crmApi.put('/auth/notification-config', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notification-config'] }),
  })

  const testWebhook = async () => {
    const url = form.getValues('webhookUrl')
    if (!url) return
    setTestStatus('sending')
    setTestDetail('')
    try {
      const res = await crmApi.post<{ data: { ok: boolean; status: number; body: string } }>('/auth/notification-config/test-webhook', { webhookUrl: url })
      const { ok, status, body } = res.data.data
      setTestStatus(ok ? 'ok' : 'fail')
      setTestDetail(`HTTP ${status}  ${body}`)
    } catch (e: unknown) {
      setTestStatus('fail')
      setTestDetail(String((e as { message?: string })?.message ?? e))
    }
    setTimeout(() => { setTestStatus('idle'); setTestDetail('') }, 8000)
  }

  if (isLoading) return <div className="text-sm text-gray-400 p-4">{t('common.loading')}</div>

  return (
    <form className="space-y-4 max-w-2xl" onSubmit={form.handleSubmit((d) => saveMutation.mutate(d))}>
      <div className="rounded-lg border bg-white p-4 sm:p-5 space-y-5">
        <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-800">{t('profile.notifications.rules.leadAssigned')}</p>
            <p className="text-xs text-gray-500 mt-0.5">{t('profile.notifications.rules.leadAssignedHint')}</p>
          </div>
          <span className="text-xs rounded-full bg-green-100 text-green-700 px-2 py-0.5 font-medium">{t('common.enabled')}</span>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium text-gray-900 text-sm">{t('profile.notifications.email')}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{t('profile.notifications.emailHint')}</p>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input type="checkbox" className="sr-only peer" {...form.register('emailEnabled')} />
            <div className="h-5 w-9 rounded-full bg-gray-200 peer-checked:bg-primary-600 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition-all peer-checked:after:translate-x-4" />
          </label>
        </div>
        {emailEnabled && (
          <Input
            label={t('profile.notifications.emailTo')}
            placeholder="your@email.com"
            error={form.formState.errors.email?.message}
            {...form.register('email')}
          />
        )}
      </div>

      <div className="rounded-lg border bg-white p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium text-gray-900 text-sm">{t('profile.notifications.webhook')}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{t('profile.notifications.webhookHint')}</p>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input type="checkbox" className="sr-only peer" {...form.register('webhookEnabled')} />
            <div className="h-5 w-9 rounded-full bg-gray-200 peer-checked:bg-primary-600 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition-all peer-checked:after:translate-x-4" />
          </label>
        </div>
        {webhookEnabled && (
          <div className="space-y-3">
            <Input
              label={t('profile.notifications.webhookUrl')}
              placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
              error={form.formState.errors.webhookUrl?.message}
              {...form.register('webhookUrl')}
            />
            <div className="rounded-md bg-gray-50 border px-3 py-2.5 text-xs text-gray-500 font-mono whitespace-pre-wrap">{t('profile.notifications.webhookExample')}</div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={testWebhook}
              loading={testStatus === 'sending'}
            >
              {testStatus === 'ok' ? `✓ ${t('profile.notifications.sent')}` : testStatus === 'fail' ? `✗ ${t('profile.notifications.sendFailed')}` : t('profile.notifications.test')}
            </Button>
            {testDetail && (
              <p className={`mt-1.5 text-xs font-mono break-all ${testStatus === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
                {testDetail}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="submit" loading={saveMutation.isPending}>{t('profile.notifications.save')}</Button>
      </div>
    </form>
  )
}

// ---- 主页面 ----
export default function ProfilePage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const validTab = TAB_KEYS.includes(tabParam as TabKey) ? (tabParam as TabKey) : 'info'
  const [activeTab, setActiveTab] = useState<TabKey>(validTab)

  useEffect(() => {
    if (validTab !== activeTab) setActiveTab(validTab)
  }, [validTab])

  const TABS = [
    { key: 'info' as TabKey,     label: t('profile.tabs.basic') },
    { key: 'password' as TabKey, label: t('profile.tabs.password') },
    { key: 'api' as TabKey,      label: t('profile.tabs.api') },
    { key: 'notify' as TabKey,   label: t('profile.tabs.notifications') },
  ]

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-lg sm:text-xl font-semibold text-gray-900">{t('profile.title')}</h1>
        <p className="mt-0.5 text-sm text-gray-500">{t('profile.subtitle')}</p>
      </div>

      <div className="mb-4 flex gap-1 border-b">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => { setActiveTab(tab.key); setSearchParams({ tab: tab.key }) }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab.key
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'info'     && <InfoTab />}
      {activeTab === 'password' && <PasswordTab />}
      {activeTab === 'api'      && <ApiTab />}
      {activeTab === 'notify'   && <NotifyTab />}
    </div>
  )
}
