// API 失败记录（管理员）：外部推送线索失败的请求，可补录为线索或忽略
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { crmApi } from '@/shared/utils/request'
import { formatDate } from '@/shared/utils/format'
import { Button } from '@/shared/components/Button'

interface ApiFailure {
  id: string
  requestBody: string
  errorMessage: string | null
  apiKeyPrefix: string | null
  siteId: string | null
  siteName: string | null
  createdAt: string
  resolvedAt: string | null
  resolution: 'created_lead' | 'dismissed' | null
}

interface ApiFailureRequestBody {
  name?: string
  contactInfo?: string
  source?: string
  intendedServices?: string[]
  [key: string]: unknown
}

/** source：site 只看网站表单的失败，api 只看对外接口的失败，不传显示全部 */
export function ApiFailuresPanel({ source }: { source?: 'site' | 'api' } = {}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['admin-api-failures'],
    queryFn: () =>
      crmApi.get<{ data: ApiFailure[] }>('/admin/api-failures').then((r) => r.data.data),
  })

  const createLeadMutation = useMutation({
    mutationFn: (id: string) =>
      crmApi.post<{ data: { leadId: string } }>(`/admin/api-failures/${id}/create-lead`, {}),
    onSuccess: () => {
      navigate('/app/leads')
    },
  })

  const dismissMutation = useMutation({
    mutationFn: (id: string) =>
      crmApi.post(`/admin/api-failures/${id}/dismiss`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-api-failures'] })
    },
  })

  const parseBody = (raw: string): ApiFailureRequestBody => {
    try {
      return JSON.parse(raw) as ApiFailureRequestBody
    } catch {
      return {}
    }
  }

  const formatContactInfo = (body: ApiFailureRequestBody): string => {
    const parts: string[] = []
    if (body.name) parts.push(body.name)
    if (body.contactInfo) parts.push(body.contactInfo)
    if (body.source) parts.push(body.source)
    if (Array.isArray(body.intendedServices) && body.intendedServices.length > 0) {
      parts.push(`[${body.intendedServices.join('、')}]`)
    }
    return parts.join(' · ') || '—'
  }

  const items = (data ?? []).filter((f) => !source || (source === 'site' ? !!f.siteId : !f.siteId))

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-white overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
          <div>
            <h2 className="font-semibold text-gray-800 text-sm">{t('settings.apiFailures.title')}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{t('settings.apiFailures.subtitle')}</p>
          </div>
          <span className="text-xs text-gray-400">{items.length} {t('common.items')}</span>
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-sm text-gray-400">{t('common.loading')}</div>
        ) : items.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">{t('settings.apiFailures.empty')}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-700 whitespace-nowrap">{t('settings.apiFailures.cols.time')}</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 whitespace-nowrap">{t('settings.apiFailures.cols.source')}</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">{t('settings.apiFailures.cols.contact')}</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700">{t('settings.apiFailures.cols.error')}</th>
                <th className="px-4 py-3 text-left font-medium text-gray-700 whitespace-nowrap">{t('settings.apiFailures.cols.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item) => {
                const body = parseBody(item.requestBody)
                const contactInfo = formatContactInfo(body)
                const isCreating = createLeadMutation.isPending && createLeadMutation.variables === item.id
                const isDismissing = dismissMutation.isPending && dismissMutation.variables === item.id
                return (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {formatDate(item.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-gray-500 font-mono text-xs whitespace-nowrap">
                      {item.siteId ? (item.siteName ?? item.siteId) : (item.apiKeyPrefix ?? '—')}
                    </td>
                    <td className="px-4 py-3 text-gray-700 text-xs max-w-xs">
                      {contactInfo}
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      {item.errorMessage ? (
                        <span className="text-xs text-red-500 line-clamp-2">{item.errorMessage}</span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <Button
                          size="sm"
                          loading={isCreating}
                          disabled={isDismissing}
                          onClick={() => createLeadMutation.mutate(item.id)}
                        >
                          {t('settings.apiFailures.createLead')}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={isDismissing}
                          disabled={isCreating}
                          onClick={() => {
                            if (confirm(t('settings.apiFailures.confirmDismiss')))
                              dismissMutation.mutate(item.id)
                          }}
                        >
                          {t('settings.apiFailures.dismiss')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
