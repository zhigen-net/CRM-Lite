// Workers AI 用量估算与助手默认模型：默认选最省额度的 Workers AI 模型，系统设置可指定
import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { estimateNeurons, recordAiUsage, todayAiUsage } from '../src/shared/aiUsage'
import { api, createUser, type TestUser } from './helpers'

let admin: TestUser, sales: TestUser
let bigId: string, smallId: string

beforeAll(async () => {
  admin = await createUser('admin')
  sales = await createUser('sales')
  const pid = `prov-${Date.now()}`
  await env.DB.prepare("INSERT INTO ai_providers (id, name, provider_type, api_key, is_active) VALUES (?, 'Workers AI 测试', 'cloudflare', '', 1)").bind(pid).run()
  await env.DB.prepare('UPDATE ai_models SET is_enabled = 0').run()
  bigId = `m-big-${Date.now()}`; smallId = `m-small-${Date.now()}`
  await env.DB.prepare("INSERT INTO ai_models (id, provider_id, model_id, display_name, is_enabled, created_at) VALUES (?, ?, '@cf/meta/llama-3.3-70b-instruct-fp8-fast', '70B', 1, '2020-01-01 00:00:00'), (?, ?, '@cf/meta/llama-3.1-8b-instruct', '8B', 1, '2020-01-02 00:00:00')")
    .bind(bigId, pid, smallId, pid).run()
})

describe('用量估算', () => {
  it('按模型价格估算 neurons；未收录的模型按参数规模估算', () => {
    expect(Math.round(estimateNeurons('@cf/meta/llama-3.3-70b-instruct-fp8-fast', 1_000_000, 0))).toBe(26_668)
    expect(estimateNeurons('@cf/qwen/qwen2.5-72b-instruct', 1000, 1000)).toBeGreaterThan(estimateNeurons('@cf/meta/llama-3.1-8b-instruct', 1000, 1000))
  })
  it('记录调用：有 usage 时用实际 token 数，按天累计', async () => {
    const before = await todayAiUsage(env.DB)
    await recordAiUsage(env.DB, '@cf/meta/llama-3.1-8b-instruct', 'x', { response: 'ok', usage: { prompt_tokens: 100_000, completion_tokens: 0 } })
    const after = await todayAiUsage(env.DB)
    expect(after.calls).toBe(before.calls + 1)
    expect(after.neurons - before.neurons).toBeGreaterThanOrEqual(2560)
    expect(after.limit).toBe(10_000)
  })
})

describe('助手默认模型', () => {
  it('未设置时默认用最省额度的 Workers AI 模型；系统设置可以指定', async () => {
    const list = async (u: TestUser) => ((await (await api(u, 'GET', '/api/ai-agent/models')).json()) as { data: { models: { id: string; isDefault: boolean }[]; usage: { limit: number } } }).data
    const d = await list(sales)
    expect(d.models.find((m) => m.isDefault)?.id).toBe(smallId)
    expect(d.usage.limit).toBe(10_000)
    expect((await api(admin, 'PUT', '/api/admin/settings', { ai_agent_model_id: bigId })).status).toBe(200)
    expect((await list(sales)).models.find((m) => m.isDefault)?.id).toBe(bigId)
    const usage = await api(admin, 'GET', '/api/admin/ai/usage')
    expect(usage.status).toBe(200)
    expect((await api(sales, 'GET', '/api/admin/ai/usage')).status).toBe(403)
  })
})
