// AI 接入：用户把 AI Agent（MCP）或外部系统接入 CRM 的统一入口
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { crmApi } from '@/shared/utils/request'
import { useCrmAuth } from '@/app/auth/CrmAuthContext'
import { Input } from '@/shared/components/Input'
import { Button } from '@/shared/components/Button'
import { Modal } from '@/shared/components/Modal'
import { formatDate } from '@/shared/utils/format'
import { ApiIntegrationDialog } from './ApiIntegrationDialog'
import { ApiScopePicker, ScopeSummary, SCOPE_PRESETS, type ApiScope } from './ApiScopePicker'

const apiKeySchema = z.object({
  name: z.string().min(1).max(50),
})
type ApiKeyForm = z.infer<typeof apiKeySchema>

interface ApiKey {
  id: string
  name: string
  keyPrefix: string
  createdAt: string
  lastUsedAt: string | null
  scopes: string[]
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

interface Service { id: string; name: string }

function ApiAccessPanel() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  // 打开 AI 接入弹窗：刚生成时带完整密钥，从列表打开时 key 为空
  const [integration, setIntegration] = useState<{ name: string; key: string | null; scopes: string[] } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => crmApi.get<{ data: ApiKey[] }>('/auth/api-keys').then((r) => r.data.data),
  })

  const { data: services } = useQuery({
    queryKey: ['services-list'],
    queryFn: () => crmApi.get<{ data: Service[] }>('/services').then((r) => r.data.data),
  })

  const form = useForm<ApiKeyForm>({ resolver: zodResolver(apiKeySchema) })
  const [scopes, setScopes] = useState<ApiScope[]>([...SCOPE_PRESETS.push])
  const closeCreate = () => { setShowCreate(false); form.reset(); setScopes([...SCOPE_PRESETS.push]) }

  const createMutation = useMutation({
    mutationFn: (body: ApiKeyForm) =>
      crmApi.post<{ data: { id: string; name: string; keyPrefix: string; key: string; scopes: string[] } }>('/auth/api-keys', { ...body, scopes }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      closeCreate()
      setIntegration({ name: res.data.data.name, key: res.data.data.key, scopes: res.data.data.scopes })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => crmApi.delete(`/auth/api-keys/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
  })

  const endpoint = `${API_BASE}/api/v1/leads`
  // 给 AI 的提示词需要完整地址（默认同源部署时 API_BASE 为空）
  const absoluteEndpoint = `${API_BASE || window.location.origin}/api/v1/leads`
  const mcpUrl = `${API_BASE || window.location.origin}/api/mcp`
  const [mcpUrlCopied, setMcpUrlCopied] = useState(false)
  // 从 MCP 卡片新建：MCP 用于管理员、客服维护数据，默认读写权限，用途预填
  const openCreateForMcp = () => {
    form.reset({ name: t('profile.api.mcpCard.defaultName') })
    setScopes([...SCOPE_PRESETS.readwrite])
    setShowCreate(true)
  }

  return (
    <div className="space-y-4 max-w-2xl">
      {/* MCP 入口：让 AI 工具直接查询和维护 CRM */}
      <div className="rounded-lg border border-primary-200 bg-primary-50/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-medium text-gray-900 text-sm">{t('profile.api.mcpCard.title')}</h2>
            <p className="mt-1 text-xs text-gray-500">{t('profile.api.mcpCard.desc')}</p>
          </div>
          <Button size="sm" onClick={openCreateForMcp}>{t('profile.api.mcpCard.create')}</Button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-gray-500 shrink-0">{t('profile.api.mcp.url')}</span>
          <code className="flex-1 min-w-0 truncate rounded bg-white border px-2 py-1 text-xs font-mono text-gray-700">{mcpUrl}</code>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => navigator.clipboard.writeText(mcpUrl).then(() => { setMcpUrlCopied(true); setTimeout(() => setMcpUrlCopied(false), 2000) }).catch(() => {})}
          >
            {mcpUrlCopied ? t('profile.api.copied') : t('profile.api.copy')}
          </Button>
        </div>
        <p className="mt-2 text-xs text-gray-400">{t('profile.api.mcpCard.steps')}</p>
      </div>

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
                <th className="px-4 py-2 text-left font-medium text-gray-700">{t('profile.api.cols.scopes')}</th>
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
                  <td className="px-4 py-2.5"><ScopeSummary scopes={k.scopes ?? []} /></td>
                  <td className="px-4 py-2.5 text-gray-500">{formatDate(k.createdAt)}</td>
                  <td className="px-4 py-2.5 text-gray-500">{k.lastUsedAt ? formatDate(k.lastUsedAt) : t('profile.api.cols.never')}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button
                      onClick={() => setIntegration({ name: k.name, key: null, scopes: k.scopes ?? [] })}
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
          scopes={integration.scopes}
          onClose={() => setIntegration(null)}
        />
      )}

      {showCreate && (
        <Modal
          title={t('profile.api.generate')}
          onClose={closeCreate}
          footer={
            <>
              <Button variant="secondary" onClick={closeCreate}>{t('common.cancel')}</Button>
              <Button loading={createMutation.isPending} disabled={scopes.length === 0} onClick={form.handleSubmit((d) => createMutation.mutate(d))}>
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
          <div className="mt-4">
            <ApiScopePicker value={scopes} onChange={setScopes} />
          </div>
        </Modal>
      )}
    </div>
  )
}

export default function AiAccessPage() {
  const { t } = useTranslation()
  const { user } = useCrmAuth()
  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex max-w-2xl flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-gray-900">{t('aiAccess.title')}</h1>
          <p className="mt-0.5 text-sm text-gray-500">{t('aiAccess.subtitle')}</p>
        </div>
        {user?.role === 'admin' && (
          <Link to="/app/settings?tab=auditLog" className="text-sm text-primary-600 hover:underline">
            {t('aiAccess.auditLink')}
          </Link>
        )}
      </div>
      <ApiAccessPanel />
    </div>
  )
}
