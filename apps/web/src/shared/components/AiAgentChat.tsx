import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { crmApi } from '@/shared/utils/request'
import { ASK_AI_EVENT } from './AskAiButton'

interface Message {
  role: 'user' | 'assistant'
  content: string
}
interface AgentModels {
  models: { id: string; displayName: string; providerType: string; isDefault: boolean }[]
  usage: { neurons: number; calls: number; limit: number }
}

export function AiAgentChat() {
  const { t } = useTranslation()
  const SUGGESTIONS: string[] = t('ai.agent.examples', { returnObjects: true }) as string[]
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const queryClient = useQueryClient()
  // 可选模型与今天的 Workers AI 免费额度用量；默认用系统设置的模型（未设置时用最省额度的）
  const { data: agent } = useQuery({
    queryKey: ['ai-agent-models'],
    queryFn: () => crmApi.get<{ data: AgentModels }>('/ai-agent/models').then((r) => r.data.data),
    enabled: open,
  })
  const [modelId, setModelId] = useState('')
  const current = agent?.models.find((m) => m.id === modelId) ?? agent?.models.find((m) => m.isDefault)
  const usageRatio = agent ? agent.usage.neurons / agent.usage.limit : 0

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || loading) return

    const newMessages: Message[] = [...messages, { role: 'user', content: trimmed }]
    setMessages(newMessages)
    setInput('')
    setLoading(true)
    setError(null)

    try {
      const res = await crmApi.post<{ data: { message: string } }>('/ai-agent/chat', {
        messages: newMessages, modelId: current?.id,
      })
      setMessages((prev) => [...prev, { role: 'assistant', content: res.data.data.message }])
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setError(msg ?? t('ai.agent.error'))
    } finally {
      queryClient.invalidateQueries({ queryKey: ['ai-agent-models'] })
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [messages, loading, current?.id])

  // 其它页面通过 askAi() 打开助手并发送问题（如详情页的「让 AI 分析」）
  useEffect(() => {
    const handler = (e: Event) => {
      const prompt = (e as CustomEvent<string>).detail
      setOpen(true)
      if (prompt) void send(prompt)
    }
    window.addEventListener(ASK_AI_EVENT, handler)
    return () => window.removeEventListener(ASK_AI_EVENT, handler)
  }, [send])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  const clearChat = () => {
    setMessages([])
    setError(null)
    inputRef.current?.focus()
  }

  return (
    <>
      {/* 悬浮按钮 */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full shadow-lg transition-all duration-200 ${
          open
            ? 'bg-gray-700 hover:bg-gray-800'
            : 'bg-violet-600 hover:bg-violet-700'
        }`}
        title={t('ai.agent.title')}
      >
        {open ? (
          <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
              d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
        )}
      </button>

      {/* 对话面板 */}
      {open && (
        <div className="fixed bottom-20 right-5 z-50 flex flex-col w-[360px] sm:w-[400px] h-[520px] rounded-2xl border bg-white shadow-2xl overflow-hidden">
          {/* 头部 */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-gradient-to-r from-violet-600 to-violet-500">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">{t('ai.agent.title')}</span>
              <span className="text-xs text-violet-200">{t('ai.agent.subtitle')}</span>
            </div>
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                className="text-xs text-violet-200 hover:text-white transition-colors"
              >
                {t('ai.agent.clear')}
              </button>
            )}
          </div>

          {/* 模型选择与免费额度提醒 */}
          {agent && agent.models.length > 0 && (
            <div className="flex items-center justify-between gap-2 border-b bg-gray-50 px-3 py-1.5 text-xs">
              <select value={current?.id ?? ''} onChange={(e) => setModelId(e.target.value)} aria-label={t('ai.agent.model')}
                className="min-w-0 max-w-[60%] truncate rounded border border-gray-200 bg-white px-1.5 py-0.5 text-gray-700">
                {agent.models.map((m) => <option key={m.id} value={m.id}>{m.displayName}</option>)}
              </select>
              {current?.providerType === 'cloudflare' && (
                <span className={usageRatio >= 0.8 ? 'font-medium text-amber-600' : 'text-gray-400'}>
                  {t('ai.agent.quota', { pct: Math.min(100, Math.round(usageRatio * 100)) })}
                </span>
              )}
            </div>
          )}
          {current?.providerType === 'cloudflare' && usageRatio >= 0.8 && (
            <div className="border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-xs text-amber-700">
              {t(usageRatio >= 1 ? 'ai.agent.quotaOut' : 'ai.agent.quotaWarn')}
            </div>
          )}

          {/* 消息区 */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && !loading && (
              <div className="pt-4">
                <p className="text-center text-xs text-gray-400 mb-4">{t('ai.agent.suggestions')}</p>
                <div className="space-y-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="w-full text-left rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:border-violet-300 hover:bg-violet-50 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                    msg.role === 'user'
                      ? 'bg-violet-600 text-white rounded-br-sm'
                      : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3">
                  <div className="flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-600">
                {error}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* 输入区 */}
          <div className="border-t p-3">
            <div className="flex items-end gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 focus-within:border-violet-400 focus-within:ring-1 focus-within:ring-violet-400 transition-all">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('ai.agent.placeholder')}
                rows={1}
                disabled={loading}
                className="flex-1 resize-none bg-transparent text-sm text-gray-800 placeholder:text-gray-400 outline-none disabled:opacity-50"
                style={{ maxHeight: '100px', overflowY: 'auto' }}
                onInput={(e) => {
                  const t = e.currentTarget
                  t.style.height = 'auto'
                  t.style.height = `${Math.min(t.scrollHeight, 100)}px`
                }}
              />
              <button
                onClick={() => send(input)}
                disabled={!input.trim() || loading}
                className="flex-shrink-0 flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600 text-white transition-colors hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.269 20.876L5.999 12zm0 0h7.5" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
