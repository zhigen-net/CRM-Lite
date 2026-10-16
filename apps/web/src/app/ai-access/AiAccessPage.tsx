// AI 接入：用户把 AI Agent（MCP）或外部系统接入 CRM 的统一入口
// 页面按用途分两块：AI 工具（MCP，日常维护数据）与外部系统推送线索，各自的密钥分开展示
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { crmApi } from '@/shared/utils/request'
import { useCrmAuth } from '@/app/auth/CrmAuthContext'
import { Input } from '@/shared/components/Input'
import { Button } from '@/shared/components/Button'
import { Modal } from '@/shared/components/Modal'
import { formatDate } from '@/shared/utils/format'
import { ApiIntegrationDialog } from './ApiIntegrationDialog'
import { ApiScopePicker, ScopeSummary, SCOPE_PRESETS, type ApiScope } from './ApiScopePicker'
import { ApiFailuresPanel } from './ApiFailuresPanel'
import { AuditLogPanel } from './AuditLogPanel'

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

interface Service { id: string; name: string }

type Section = 'mcp' | 'push'

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ''

/** 只有推送线索权限的是推送密钥，其余（有查询/修改权限）归为 MCP 密钥 */
const isMcpKey = (k: ApiKey) => (k.scopes ?? []).some((s) => s !== 'leads:create')

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => {})}
    >
      {copied ? t('profile.api.copied') : t('profile.api.copy')}
    </Button>
  )
}

function KeyList({ keys, loading, emptyText, onView, onRevoke }: {
  keys: ApiKey[]
  loading: boolean
  emptyText: string
  onView: (k: ApiKey) => void
  onRevoke: (k: ApiKey) => void
}) {
  const { t } = useTranslation()
  if (loading) return <div className="px-4 py-6 text-sm text-gray-400">{t('common.loading')}</div>
  if (keys.length === 0) return <div className="px-4 py-6 text-center text-sm text-gray-400">{emptyText}</div>
  return (
    <ul className="divide-y divide-gray-100">
      {keys.map((k) => (
        <li key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900">{k.name}</p>
            <p className="mt-0.5 text-xs text-gray-400">
              <span className="font-mono">{k.keyPrefix}…</span>
              <span className="mx-1.5">·</span>
              {k.lastUsedAt ? t('aiAccess.keys.lastUsed', { time: formatDate(k.lastUsedAt) }) : t('aiAccess.keys.neverUsed')}
            </p>
          </div>
          <span className="rounded-full bg-gray-100 px-2 py-0.5"><ScopeSummary scopes={k.scopes ?? []} /></span>
          <div className="flex items-center gap-3 text-xs">
            <button onClick={() => onView(k)} className="text-primary-600 hover:text-primary-800">{t('aiAccess.keys.view')}</button>
            <button onClick={() => onRevoke(k)} className="text-red-500 hover:text-red-700">{t('profile.api.revoke')}</button>
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function AiAccessPage() {
  const { t } = useTranslation()
  const { user } = useCrmAuth()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const section: Section = searchParams.get('tab') === 'push' ? 'push' : 'mcp'

  const [creating, setCreating] = useState<Section | null>(null)
  // 配置弹窗：刚生成时带完整密钥，从列表打开时 key 为空
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
  const [scopes, setScopes] = useState<ApiScope[]>([...SCOPE_PRESETS.readwrite])

  // MCP 用于管理员、客服维护数据，默认读写；推送密钥只给推送权限
  const openCreate = (kind: Section) => {
    form.reset({ name: t(`aiAccess.${kind}.defaultName`) })
    setScopes([...(kind === 'mcp' ? SCOPE_PRESETS.readwrite : SCOPE_PRESETS.push)])
    setCreating(kind)
  }
  const closeCreate = () => { setCreating(null); form.reset() }

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

  const origin = API_BASE || window.location.origin
  const mcpUrl = `${origin}/api/mcp`
  const endpoint = `${origin}/api/v1/leads`
  const keys = data ?? []
  const mcpKeys = keys.filter(isMcpKey)
  const pushKeys = keys.filter((k) => !isMcpKey(k))

  const view = (k: ApiKey) => setIntegration({ name: k.name, key: null, scopes: k.scopes ?? [] })
  const revoke = (k: ApiKey) => { if (confirm(t('profile.api.revokeConfirm', { name: k.name }))) deleteMutation.mutate(k.id) }

  const sectionCard = (s: Section, icon: string) => (
    <button
      type="button"
      onClick={() => setSearchParams({ tab: s })}
      className={`flex-1 rounded-lg border p-4 text-left transition-colors ${section === s
        ? 'border-primary-500 bg-primary-50/50 ring-1 ring-primary-500'
        : 'border-gray-200 bg-white hover:border-gray-300'}`}
    >
      <p className="text-sm font-medium text-gray-900"><span className="mr-1.5">{icon}</span>{t(`aiAccess.sections.${s}.title`)}</p>
      <p className="mt-1 text-xs text-gray-500">{t(`aiAccess.sections.${s}.desc`)}</p>
      <p className="mt-2 text-xs text-gray-400">{t('aiAccess.sections.keyCount', { count: s === 'mcp' ? mcpKeys.length : pushKeys.length })}</p>
    </button>
  )

  return (
    <div className="p-4 sm:p-6">
      <div className="max-w-4xl space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-gray-900">{t('aiAccess.title')}</h1>
            <p className="mt-0.5 text-sm text-gray-500">{t('aiAccess.subtitle')}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          {sectionCard('mcp', '🤖')}
          {sectionCard('push', '🔗')}
        </div>

        {section === 'mcp' ? (
          <>
            {/* 接入步骤 */}
            <div className="rounded-lg border bg-white p-4 sm:p-5">
              <h2 className="text-sm font-medium text-gray-900">{t('aiAccess.mcp.stepsTitle')}</h2>
              <ol className="mt-3 grid gap-3 sm:grid-cols-3">
                {[1, 2, 3].map((n) => (
                  <li key={n} className="rounded-md bg-gray-50 p-3">
                    <p className="text-sm font-medium text-gray-800">
                      <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary-600 text-xs text-white">{n}</span>
                      {t(`aiAccess.mcp.step${n}.title`)}
                    </p>
                    <p className="mt-1.5 text-xs text-gray-500">{t(`aiAccess.mcp.step${n}.desc`)}</p>
                    {n === 1 && <div className="mt-2"><Button size="sm" onClick={() => openCreate('mcp')}>{t('aiAccess.mcp.create')}</Button></div>}
                  </li>
                ))}
              </ol>
              <div className="mt-4 flex items-center gap-2">
                <span className="shrink-0 text-xs text-gray-500">{t('profile.api.mcp.url')}</span>
                <code className="min-w-0 flex-1 truncate rounded border bg-gray-50 px-2 py-1 font-mono text-xs text-gray-700">{mcpUrl}</code>
                <CopyButton text={mcpUrl} />
              </div>
              <div className="mt-4">
                <p className="text-xs text-gray-500">{t('aiAccess.mcp.examplesTitle')}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {[1, 2, 3, 4].map((n) => (
                    <span key={n} className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600">{t(`aiAccess.mcp.example${n}`)}</span>
                  ))}
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border bg-white">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h2 className="text-sm font-medium text-gray-900">{t('aiAccess.mcp.keysTitle')}</h2>
                <Button size="sm" variant="secondary" onClick={() => openCreate('mcp')}>{t('aiAccess.mcp.create')}</Button>
              </div>
              <KeyList keys={mcpKeys} loading={isLoading} emptyText={t('aiAccess.mcp.empty')} onView={view} onRevoke={revoke} />
            </div>
          </>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border bg-white">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-medium text-gray-900">{t('aiAccess.push.keysTitle')}</h2>
                  <p className="mt-0.5 text-xs text-gray-500">{t('aiAccess.push.intro')}</p>
                </div>
                <Button size="sm" onClick={() => openCreate('push')}>{t('aiAccess.push.create')}</Button>
              </div>
              <KeyList keys={pushKeys} loading={isLoading} emptyText={t('aiAccess.push.empty')} onView={view} onRevoke={revoke} />
            </div>

            {/* 接口说明：默认折叠，接入时可交给 AI 读取 llms.txt */}
            <details className="rounded-lg border bg-white">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-900">{t('aiAccess.push.docsToggle')}</summary>
              <div className="space-y-3 border-t px-4 py-4 text-sm">
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded border bg-gray-50 px-2 py-1 font-mono text-xs text-gray-700">POST {endpoint}</code>
                  <CopyButton text={endpoint} />
                </div>
                <p className="text-xs text-gray-500">
                  {t('aiAccess.push.llmsHint')}{' '}
                  <a href={`${origin}/api/v1/llms.txt`} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">llms.txt</a>
                  {' · '}
                  <a href={`${origin}/api/v1/openapi.json`} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">openapi.json</a>
                </p>
                <div>
                  <p className="mb-1 text-gray-500">{t('profile.api.docs.headers')}</p>
                  <code className="block whitespace-pre rounded border bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700">{`Content-Type: application/json\nX-API-Key: <${t('profile.api.docs.yourApiKey')}>`}</code>
                </div>
                <div>
                  <p className="mb-1 text-gray-500">{t('profile.api.docs.body')}</p>
                  <code className="block whitespace-pre rounded border bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700">{t('profile.api.docs.bodyExample')}</code>
                </div>
                {services && services.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-gray-500">{t('profile.api.docs.services')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {services.map((s) => (
                        <span key={s.id} className="rounded border border-gray-200 bg-white px-2 py-0.5 font-mono text-xs text-gray-700">{s.name}</span>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-gray-400">{t('profile.api.docs.servicesHint')}</p>
                  </div>
                )}
                <p className="text-xs text-gray-400">{t('profile.api.docs.adInfo')}</p>
                <div>
                  <p className="mb-1 text-gray-500">{t('profile.api.docs.response')}</p>
                  <code className="block rounded border bg-gray-50 px-3 py-2 font-mono text-xs text-gray-700">{`{ "data": { "id": "uuid", "status": "New" } }`}</code>
                </div>
              </div>
            </details>
          </>
        )}

        {/* 管理员：MCP / API Key 的调用记录；推送线索失败的请求 */}
        {user?.role === 'admin' && (section === 'mcp' ? <AuditLogPanel /> : <ApiFailuresPanel />)}
      </div>

      {integration && (
        <ApiIntegrationDialog
          endpoint={endpoint}
          services={(services ?? []).map((s) => s.name)}
          apiKey={integration.key}
          keyName={integration.name}
          scopes={integration.scopes}
          onClose={() => setIntegration(null)}
        />
      )}

      {creating && (
        <Modal
          title={t(`aiAccess.${creating}.create`)}
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
