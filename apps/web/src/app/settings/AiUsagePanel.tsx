// AI 助手：默认模型与 Workers AI 免费额度用量（估算）
// 免费额度每天 10,000 neurons（UTC 0 点重置）；用量按模型价格估算，以 Cloudflare 控制台为准
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { crmApi } from '@/shared/utils/request'
import { cn } from '@/shared/utils/cn'

interface Usage { neurons: number; calls: number; limit: number }
interface DayRow { day: string; modelId: string; calls: number; neurons: number }
interface ModelOption { id: string; displayName: string; providerType: string; isEnabled: number }

export function usageTone(u: Usage) {
  const r = u.neurons / u.limit
  return r >= 1 ? 'red' : r >= 0.8 ? 'amber' : 'green'
}

export function AiUsagePanel({ models, currentModelId }: { models: ModelOption[]; currentModelId: string | undefined }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['ai-usage'],
    queryFn: () => crmApi.get<{ data: { today: Usage; days: DayRow[] } }>('/admin/ai/usage').then((r) => r.data.data),
  })
  const enabled = models.filter((m) => m.isEnabled)
  const save = (v: string) => crmApi.put('/admin/settings', { ai_agent_model_id: v }).then(() => {
    queryClient.invalidateQueries({ queryKey: ['system-settings'] })
    queryClient.invalidateQueries({ queryKey: ['ai-agent-models'] })
  })
  const today = data?.today
  const pct = today ? Math.min(100, Math.round((today.neurons / today.limit) * 100)) : 0
  const tone = today ? usageTone(today) : 'green'

  return (
    <div className="rounded-lg border bg-white">
      <div className="border-b bg-gray-50 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-800">{t('settings.aiUsage.title')}</h2>
      </div>
      <div className="space-y-4 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700">{t('settings.aiUsage.defaultModel')}</p>
            <p className="mt-0.5 text-xs text-gray-400">{t('settings.aiUsage.defaultModelHint')}</p>
          </div>
          <select value={currentModelId ?? ''} onChange={(e) => save(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 sm:w-72">
            <option value="">{t('settings.aiUsage.auto')}</option>
            {enabled.map((m) => <option key={m.id} value={m.id}>{m.displayName}{m.providerType === 'cloudflare' ? ' · Workers AI' : ''}</option>)}
          </select>
        </div>

        {today && (
          <div>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="text-gray-700">{t('settings.aiUsage.today')}</span>
              <span className="text-gray-900"><b>{today.neurons.toLocaleString()}</b> / {today.limit.toLocaleString()} neurons · {t('settings.aiUsage.calls', { count: today.calls })}</span>
            </div>
            <div className="h-2 rounded-full bg-gray-100">
              <div className={cn('h-2 rounded-full', tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-primary-500')} style={{ width: `${Math.max(1, pct)}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-gray-400">{t('settings.aiUsage.hint')}</p>
          </div>
        )}

        {!!data?.days.length && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b text-left text-gray-500">
                <th className="py-1.5 pr-3 font-medium">{t('settings.aiUsage.day')}</th>
                <th className="py-1.5 pr-3 font-medium">{t('settings.aiUsage.model')}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{t('settings.aiUsage.callsCol')}</th>
                <th className="py-1.5 text-right font-medium">neurons</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {data.days.map((d) => (
                  <tr key={d.day + d.modelId}>
                    <td className="py-1.5 pr-3 text-gray-600">{d.day}</td>
                    <td className="py-1.5 pr-3 font-mono text-gray-600">{d.modelId.replace('@cf/', '')}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-gray-700">{d.calls}</td>
                    <td className="py-1.5 text-right tabular-nums text-gray-900">{Math.round(d.neurons).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
