// Workers AI 用量估算：免费额度为每天 10,000 neurons（UTC 0 点重置）
// neurons 按各模型公开价格换算（每百万 token 的 neurons），未收录的模型按参数规模估算；只作提醒用，以 Cloudflare 控制台为准
export const FREE_NEURONS_PER_DAY = 10_000
export const WARN_RATIO = 0.8

/** 每百万 token 的 neurons：[输入, 输出] */
const RATES: Record<string, [number, number]> = {
  '@cf/meta/llama-3.1-8b-instruct': [25_608, 75_147],
  '@cf/meta/llama-3.1-8b-instruct-fast': [4_119, 34_868],
  '@cf/meta/llama-3.2-3b-instruct': [4_625, 30_475],
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': [26_668, 204_805],
  '@cf/google/gemma-3-12b-it': [31_371, 50_560],
  '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b': [45_170, 443_756],
  '@cf/mistralai/mistral-small-3.1-24b-instruct': [31_876, 50_488],
}

export function neuronRates(modelId: string): [number, number] {
  const known = RATES[modelId]
  if (known) return known
  // 按名字里的参数规模估算（如 72b、32b、8b），越大越贵
  const size = Number(modelId.match(/(\d+(?:\.\d+)?)b/i)?.[1] ?? 0)
  if (size >= 60) return [26_668, 204_805]
  if (size >= 20) return [45_170, 200_000]
  return [25_608, 75_147]
}

export function estimateNeurons(modelId: string, inputTokens: number, outputTokens: number): number {
  const [i, o] = neuronRates(modelId)
  return (inputTokens * i + outputTokens * o) / 1_000_000
}

/** 粗略估算 token 数（模型没返回 usage 时用）：中文约 1.5 字 / token，英文约 4 字符 / token，取中间值 */
export const roughTokens = (text: string) => Math.ceil(text.length / 2)

const utcDay = () => new Date().toISOString().slice(0, 10)

/** 记录一次 Workers AI 调用；result 里有 usage 时用实际 token 数 */
export async function recordAiUsage(db: D1Database, modelId: string, promptText: string, result: unknown): Promise<void> {
  const usage = (result as { usage?: { prompt_tokens?: number; completion_tokens?: number } } | null)?.usage
  const reply = (result as { response?: unknown } | null)?.response
  const input = usage?.prompt_tokens ?? roughTokens(promptText)
  const output = usage?.completion_tokens ?? roughTokens(typeof reply === 'string' ? reply : '')
  await db.prepare(`
    INSERT INTO ai_usage_daily (day, model_id, calls, input_tokens, output_tokens, neurons) VALUES (?, ?, 1, ?, ?, ?)
    ON CONFLICT(day, model_id) DO UPDATE SET calls = calls + 1, input_tokens = input_tokens + excluded.input_tokens,
      output_tokens = output_tokens + excluded.output_tokens, neurons = neurons + excluded.neurons`,
  ).bind(utcDay(), modelId, input, output, estimateNeurons(modelId, input, output)).run()
}

export async function todayAiUsage(db: D1Database) {
  const row = await db.prepare('SELECT COALESCE(SUM(neurons), 0) AS neurons, COALESCE(SUM(calls), 0) AS calls FROM ai_usage_daily WHERE day = ?')
    .bind(utcDay()).first<{ neurons: number; calls: number }>()
  return { neurons: Math.round(row?.neurons ?? 0), calls: row?.calls ?? 0, limit: FREE_NEURONS_PER_DAY }
}

/** 近 7 天每天的用量（设置页展示） */
export async function recentAiUsage(db: D1Database) {
  const rows = await db.prepare(`SELECT day, model_id, calls, input_tokens, output_tokens, neurons FROM ai_usage_daily
    WHERE day >= date('now', '-6 days') ORDER BY day DESC, neurons DESC`).all<Record<string, unknown>>()
  return rows.results
}
