import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Modal } from '@/shared/components/Modal'
import { Button } from '@/shared/components/Button'

export const INTEGRATION_SCENARIOS = ['website', 'webhook', 'generic'] as const
export type IntegrationScenario = typeof INTEGRATION_SCENARIOS[number]

interface PromptInput {
  scenario: IntegrationScenario
  endpoint: string
  /** 刚生成的完整密钥；为空时提示词改为从环境变量读取 */
  apiKey: string | null
  services: string[]
}

/** 接口地址对应的 AI 可读说明地址（/api/v1/llms.txt） */
export function docsUrlOf(endpoint: string): string {
  return endpoint.replace(/\/leads$/, '/llms.txt')
}

/** 与服务端 pickFallbackService 一致：未收录的服务改记为系统里已有的「其他 / Other」 */
function fallbackServiceOf(services: string[]): string {
  for (const alias of ['其他', '其它', 'other', 'others']) {
    const hit = services.find((n) => n.trim().toLowerCase() === alias)
    if (hit) return hit
  }
  return '其他'
}

function keyLineOf(t: TFunction, apiKey: string | null): string {
  return apiKey ? t('profile.api.prompt.keyInline', { key: apiKey }) : t('profile.api.prompt.keyEnv')
}

/** 拼接交给 AI 的完整接入提示词（接口地址、密钥、字段、当前服务列表、场景要求） */
export function buildIntegrationPrompt(t: TFunction, input: PromptInput): string {
  const p = 'profile.api.prompt'
  const keyLine = keyLineOf(t, input.apiKey)
  return [
    t(`${p}.task.${input.scenario}`),
    t(`${p}.spec`, {
      endpoint: input.endpoint,
      docsUrl: docsUrlOf(input.endpoint),
      keyLine,
      fallback: fallbackServiceOf(input.services),
      services: input.services.length > 0 ? input.services.join('、') : t(`${p}.noServices`),
    }),
    t(`${p}.req.${input.scenario}`),
    t(`${p}.verify`),
  ].join('\n\n')
}

/** 简短版：让 AI 自己读取 llms.txt，适合能联网的 AI */
export function buildShortPrompt(t: TFunction, input: Omit<PromptInput, 'services'>): string {
  return t('profile.api.prompt.short', {
    docsUrl: docsUrlOf(input.endpoint),
    task: t(`profile.api.prompt.shortTask.${input.scenario}`),
    keyLine: keyLineOf(t, input.apiKey),
  })
}

/** 带真实密钥（或环境变量占位）的 cURL 试运行命令（dryRun，不会创建线索） */
export function buildCurlCommand(t: TFunction, endpoint: string, apiKey: string | null, services: string[]): string {
  const key = apiKey ?? '$CRM_API_KEY'
  const body = JSON.stringify({
    source: t('profile.api.prompt.testSource'),
    name: t('profile.api.prompt.testName'),
    contactInfo: '13800000000',
    intendedServices: [services[0] ?? t('profile.api.prompt.testService')],
  })
  return `curl -X POST '${endpoint}?dryRun=1' \\\n  -H "Content-Type: application/json" \\\n  -H "X-API-Key: ${key}" \\\n  -d '${body}'`
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id)
      setTimeout(() => setCopied((cur) => (cur === id ? null : cur)), 2000)
    }).catch(() => {})
  }
  return { copied, copy }
}

interface Props {
  endpoint: string
  services: string[]
  /** 刚生成时传入完整密钥；从列表打开时为空 */
  apiKey: string | null
  keyName: string
  onClose: () => void
}

/** 生成密钥后（或从密钥列表）打开：一键复制给 AI 的接入提示词 */
export function ApiIntegrationDialog({ endpoint, services, apiKey, keyName, onClose }: Props) {
  const { t } = useTranslation()
  const [scenario, setScenario] = useState<IntegrationScenario>('website')
  const { copied, copy } = useCopy()

  const prompt = buildIntegrationPrompt(t, { scenario, endpoint, apiKey, services })
  const shortPrompt = buildShortPrompt(t, { scenario, endpoint, apiKey })
  const curl = buildCurlCommand(t, endpoint, apiKey, services)

  return (
    <Modal
      title={apiKey ? t('profile.api.prompt.createdTitle') : t('profile.api.prompt.title', { name: keyName })}
      onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose}>{apiKey ? t('profile.api.dismiss') : t('common.close')}</Button>}
    >
      <div className="space-y-4 text-sm">
        {apiKey ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="text-xs font-medium text-amber-800 mb-2">{t('profile.api.notice')}</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-white border border-amber-200 px-2 py-1.5 text-xs font-mono text-gray-800">
                {apiKey}
              </code>
              <Button size="sm" variant="secondary" onClick={() => copy('key', apiKey)}>
                {copied === 'key' ? t('profile.api.copied') : t('profile.api.copy')}
              </Button>
            </div>
          </div>
        ) : (
          <p className="rounded bg-gray-50 border px-3 py-2 text-xs text-gray-500">{t('profile.api.prompt.keyHiddenHint')}</p>
        )}

        <div>
          <p className="text-gray-700 font-medium mb-1.5">{t('profile.api.prompt.scenarioLabel')}</p>
          <div className="grid grid-cols-3 gap-1.5">
            {INTEGRATION_SCENARIOS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScenario(s)}
                className={`rounded border px-2 py-1.5 text-xs ${scenario === s
                  ? 'border-primary-500 bg-primary-50 text-primary-700 font-medium'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
              >
                {t(`profile.api.prompt.scenarios.${s}`)}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-gray-400">{t(`profile.api.prompt.scenarioDesc.${scenario}`)}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => copy('prompt', prompt)}>
            {copied === 'prompt' ? t('profile.api.copied') : t('profile.api.prompt.copyPrompt')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => copy('short', shortPrompt)}>
            {copied === 'short' ? t('profile.api.copied') : t('profile.api.prompt.copyShort')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => copy('curl', curl)}>
            {copied === 'curl' ? t('profile.api.copied') : t('profile.api.prompt.copyCurl')}
          </Button>
        </div>

        <details className="rounded border">
          <summary className="cursor-pointer px-3 py-2 text-xs text-gray-500">{t('profile.api.prompt.preview')}</summary>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all border-t bg-gray-50 px-3 py-2 text-xs text-gray-700">{prompt}</pre>
        </details>

        <p className="text-xs text-gray-400">{t('profile.api.prompt.securityTip')}</p>
      </div>
    </Modal>
  )
}
