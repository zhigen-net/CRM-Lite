// 「让 AI 分析」：打开右下角 AI 助手并发送预设问题（替代原来的 AI 分析卡片）
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { crmApi } from '@/shared/utils/request'

export const ASK_AI_EVENT = 'kelu:ask-ai'

/** 让 AI 助手打开并发送一条消息 */
export function askAi(prompt: string) {
  window.dispatchEvent(new CustomEvent<string>(ASK_AI_EVENT, { detail: prompt }))
}

export function AskAiButton({ prompt }: { prompt: string }) {
  const { t } = useTranslation()
  const { data } = useQuery({
    queryKey: ['public-settings'],
    queryFn: () => crmApi.get<{ data: { aiAgentEnabled: boolean } }>('/public/settings').then((r) => r.data.data),
    staleTime: 1000 * 60 * 60,
  })
  if (data?.aiAgentEnabled === false) return null
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-violet-200 bg-violet-50/60 px-4 py-3 sm:mb-6">
      <p className="text-sm text-violet-900">{t('ai.ask.hint')}</p>
      <button type="button" onClick={() => askAi(prompt)}
        className="rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700">
        {t('ai.ask.button')}
      </button>
    </div>
  )
}
