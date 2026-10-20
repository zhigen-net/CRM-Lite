import { Hono } from 'hono'
import { recentAiUsage, recordAiUsage, todayAiUsage } from '../../shared/aiUsage'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { v4 as uuidv4 } from 'uuid'
import { requireAuth } from '../middleware/auth'
import { toCamel, toCamelList } from '../../shared/db'

export const aiConfigRoutes = new Hono<{ Bindings: Env }>()

aiConfigRoutes.use('*', requireAuth)

// 仅 admin 可操作
function requireAdmin(role: string) {
  if (role !== 'admin') throw new HTTPException(403, { message: '仅管理员可操作' })
}

// API Key 脱敏：保留前4位和后4位，中间替换为 ****
function maskKey(key: string): string {
  if (key.length <= 8) return '****'
  return `${key.slice(0, 8)}...${key.slice(-4)}`
}

// Anthropic 内置模型列表（无公开 list 接口）
const ANTHROPIC_BUILTIN = [
  { id: 'claude-opus-4-5',            name: 'Claude Opus 4.5' },
  { id: 'claude-sonnet-4-5',          name: 'Claude Sonnet 4.5' },
  { id: 'claude-haiku-4-5-20251001',  name: 'Claude Haiku 4.5' },
  { id: 'claude-opus-4-0',            name: 'Claude Opus 4.0' },
  { id: 'claude-sonnet-4-0',          name: 'Claude Sonnet 4.0' },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
  { id: 'claude-3-5-haiku-20241022',  name: 'Claude 3.5 Haiku' },
  { id: 'claude-3-opus-20240229',     name: 'Claude 3 Opus' },
]

// Cloudflare Workers AI 内置模型列表（原生绑定，无需 API Key）
const CLOUDFLARE_BUILTIN = [
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B Instruct (快速)' },
  { id: '@cf/meta/llama-3.1-8b-instruct',           name: 'Llama 3.1 8B Instruct' },
  { id: '@cf/google/gemma-3-12b-it',                name: 'Gemma 3 12B' },
  { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', name: 'DeepSeek R1 Distill Qwen 32B' },
  { id: '@cf/qwen/qwen2.5-72b-instruct',            name: 'Qwen 2.5 72B Instruct' },
]

// ─── 提供商 ────────────────────────────────────────────────────────────────

// GET /api/admin/ai/providers
aiConfigRoutes.get('/providers', async (c) => {
  const { role } = c.get('jwtPayload')
  requireAdmin(role)

  const rows = await c.env.DB.prepare(
    'SELECT id, name, provider_type, api_key, base_url, is_active, created_at FROM ai_providers ORDER BY created_at ASC',
  ).all()

  const data = (rows.results as Record<string, unknown>[]).map((r) => {
    const p = toCamel(r) as Record<string, unknown>
    p.apiKeyMasked = maskKey(p.apiKey as string)
    delete p.apiKey   // 不返回明文
    return p
  })
  return c.json({ data })
})

// POST /api/admin/ai/providers
aiConfigRoutes.post(
  '/providers',
  zValidator('json', z.object({
    name:         z.string().min(1, '请填写名称'),
    providerType: z.enum(['openai', 'anthropic', 'custom', 'cloudflare']),
    apiKey:       z.string().optional().default(''),
    baseUrl:      z.string().url().optional().or(z.literal('')),
  })),
  async (c) => {
    const { role } = c.get('jwtPayload')
    requireAdmin(role)

    const body = c.req.valid('json')
    if (body.providerType !== 'cloudflare' && !body.apiKey) {
      throw new HTTPException(400, { message: '请填写 API Key' })
    }
    const id = uuidv4()

    await c.env.DB.prepare(
      'INSERT INTO ai_providers (id, name, provider_type, api_key, base_url) VALUES (?, ?, ?, ?, ?)',
    ).bind(id, body.name, body.providerType, body.apiKey ?? '', body.baseUrl || null).run()

    return c.json({
      data: {
        id, name: body.name, providerType: body.providerType,
        apiKeyMasked: body.apiKey ? maskKey(body.apiKey) : '（无需配置）',
        baseUrl: body.baseUrl || null, isActive: 1,
      },
    }, 201)
  },
)

// PUT /api/admin/ai/providers/:id
aiConfigRoutes.put(
  '/providers/:id',
  zValidator('json', z.object({
    name:         z.string().min(1).optional(),
    apiKey:       z.string().min(1).optional(),
    baseUrl:      z.string().url().optional().or(z.literal('')),
    isActive:     z.number().int().min(0).max(1).optional(),
  })),
  async (c) => {
    const { role } = c.get('jwtPayload')
    requireAdmin(role)
    const id = c.req.param('id')
    const body = c.req.valid('json')

    const existing = await c.env.DB.prepare('SELECT id FROM ai_providers WHERE id = ?').bind(id).first()
    if (!existing) throw new HTTPException(404, { message: '提供商不存在' })

    const updates: string[] = []
    const params: unknown[] = []
    if (body.name     !== undefined) { updates.push('name = ?');       params.push(body.name) }
    if (body.apiKey   !== undefined) { updates.push('api_key = ?');    params.push(body.apiKey) }
    if (body.baseUrl  !== undefined) { updates.push('base_url = ?');   params.push(body.baseUrl || null) }
    if (body.isActive !== undefined) { updates.push('is_active = ?');  params.push(body.isActive) }

    if (updates.length > 0) {
      params.push(id)
      await c.env.DB.prepare(`UPDATE ai_providers SET ${updates.join(', ')} WHERE id = ?`)
        .bind(...params).run()
    }
    return c.json({ data: { success: true } })
  },
)

// DELETE /api/admin/ai/providers/:id
aiConfigRoutes.delete('/providers/:id', async (c) => {
  const { role } = c.get('jwtPayload')
  requireAdmin(role)
  const id = c.req.param('id')

  const existing = await c.env.DB.prepare('SELECT id FROM ai_providers WHERE id = ?').bind(id).first()
  if (!existing) throw new HTTPException(404, { message: '提供商不存在' })

  // CASCADE 会自动删除关联的 ai_models
  await c.env.DB.prepare('DELETE FROM ai_providers WHERE id = ?').bind(id).run()
  return c.json({ data: { success: true } })
})

// 解析 OpenAI 兼容接口的 base URL
// 规则：直接使用用户填写的值，去掉末尾 /，默认 https://api.openai.com/v1
// 用户应填写不含具体端点的根路径，如 https://api.openai.com/v1 或 https://gateway.ai.cloudflare.com/v1/{acct}/{gw}/openai
function resolveOpenAIBase(baseUrl: string | null): string {
  return (baseUrl ?? '').replace(/\/$/, '') || 'https://api.openai.com/v1'
}

// ─── 查询提供商可用模型（从外部 API 拉取） ─────────────────────────────────

// GET /api/admin/ai/providers/:id/available-models
aiConfigRoutes.get('/providers/:id/available-models', async (c) => {
  const { role } = c.get('jwtPayload')
  requireAdmin(role)
  const id = c.req.param('id')

  const provider = await c.env.DB.prepare(
    'SELECT * FROM ai_providers WHERE id = ?',
  ).bind(id).first<{ provider_type: string; api_key: string; base_url: string | null }>()
  if (!provider) throw new HTTPException(404, { message: '提供商不存在' })

  // Cloudflare Workers AI：返回内置列表
  if (provider.provider_type === 'cloudflare') {
    return c.json({ data: CLOUDFLARE_BUILTIN.map((m) => ({ id: m.id, name: m.name })) })
  }

  // Anthropic：无公开 list 接口，返回内置列表
  if (provider.provider_type === 'anthropic') {
    return c.json({ data: ANTHROPIC_BUILTIN.map((m) => ({ id: m.id, name: m.name })) })
  }

  // OpenAI 或兼容接口
  const baseUrl = resolveOpenAIBase(provider.base_url)
  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${provider.api_key}` },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new HTTPException(502, { message: `提供商返回错误：${res.status} ${text.slice(0, 200)}` })
    }
    const json = await res.json() as { data?: { id: string; owned_by?: string }[] }
    const models = (json.data ?? []).map((m) => ({ id: m.id, name: m.id }))
    return c.json({ data: models })
  } catch (e) {
    if (e instanceof HTTPException) throw e
    throw new HTTPException(502, { message: `请求提供商失败：${String(e)}` })
  }
})

// ─── 已启用模型管理 ─────────────────────────────────────────────────────────

// GET /api/admin/ai/models
// GET /api/admin/ai/usage —— Workers AI 今天与近 7 天的用量（估算）
aiConfigRoutes.get('/usage', async (c) => {
  requireAdmin(c.get('jwtPayload').role)
  return c.json({ data: { today: await todayAiUsage(c.env.DB), days: toCamelList(await recentAiUsage(c.env.DB)) } })
})

aiConfigRoutes.get('/models', async (c) => {
  const { role } = c.get('jwtPayload')
  requireAdmin(role)

  const rows = await c.env.DB.prepare(`
    SELECT m.id, m.model_id, m.display_name, m.is_enabled, m.created_at,
           p.id as provider_id, p.name as provider_name, p.provider_type
    FROM ai_models m JOIN ai_providers p ON m.provider_id = p.id
    ORDER BY p.name ASC, m.display_name ASC
  `).all()

  return c.json({ data: toCamelList(rows.results as Record<string, unknown>[]) })
})

// POST /api/admin/ai/models  —— 启用一个模型
aiConfigRoutes.post(
  '/models',
  zValidator('json', z.object({
    providerId:  z.string().min(1),
    modelId:     z.string().min(1),
    displayName: z.string().min(1),
  })),
  async (c) => {
    const { role } = c.get('jwtPayload')
    requireAdmin(role)
    const body = c.req.valid('json')

    const provider = await c.env.DB.prepare('SELECT id FROM ai_providers WHERE id = ?')
      .bind(body.providerId).first()
    if (!provider) throw new HTTPException(404, { message: '提供商不存在' })

    // 已存在则直接重新启用
    const existing = await c.env.DB.prepare(
      'SELECT id FROM ai_models WHERE provider_id = ? AND model_id = ?',
    ).bind(body.providerId, body.modelId).first<{ id: string }>()

    if (existing) {
      await c.env.DB.prepare(
        'UPDATE ai_models SET is_enabled = 1, display_name = ? WHERE id = ?',
      ).bind(body.displayName, existing.id).run()
      return c.json({ data: { id: existing.id, ...body, isEnabled: 1 } })
    }

    const id = uuidv4()
    await c.env.DB.prepare(
      'INSERT INTO ai_models (id, provider_id, model_id, display_name) VALUES (?, ?, ?, ?)',
    ).bind(id, body.providerId, body.modelId, body.displayName).run()
    return c.json({ data: { id, ...body, isEnabled: 1 } }, 201)
  },
)

// PUT /api/admin/ai/models/:id  —— 修改显示名称
aiConfigRoutes.put(
  '/models/:id',
  zValidator('json', z.object({ displayName: z.string().min(1) })),
  async (c) => {
    const { role } = c.get('jwtPayload')
    requireAdmin(role)
    const id = c.req.param('id')
    const { displayName } = c.req.valid('json')

    const existing = await c.env.DB.prepare('SELECT id FROM ai_models WHERE id = ?').bind(id).first()
    if (!existing) throw new HTTPException(404, { message: '模型不存在' })

    await c.env.DB.prepare('UPDATE ai_models SET display_name = ? WHERE id = ?')
      .bind(displayName, id).run()
    return c.json({ data: { success: true } })
  },
)

// DELETE /api/admin/ai/models/:id  —— 移除模型
aiConfigRoutes.delete('/models/:id', async (c) => {
  const { role } = c.get('jwtPayload')
  requireAdmin(role)
  const id = c.req.param('id')

  const existing = await c.env.DB.prepare('SELECT id FROM ai_models WHERE id = ?').bind(id).first()
  if (!existing) throw new HTTPException(404, { message: '模型不存在' })

  await c.env.DB.prepare('DELETE FROM ai_models WHERE id = ?').bind(id).run()
  return c.json({ data: { success: true } })
})

// POST /api/admin/ai/models/:id/test  —— 测试模型连通性
aiConfigRoutes.post(
  '/models/:id/test',
  zValidator('json', z.object({ prompt: z.string().min(1).default('你好，请用一句话介绍你自己。') })),
  async (c) => {
    const { role } = c.get('jwtPayload')
    requireAdmin(role)
    const id = c.req.param('id')
    const { prompt } = c.req.valid('json')

    const row = await c.env.DB.prepare(`
      SELECT m.model_id, p.provider_type, p.api_key, p.base_url
      FROM ai_models m JOIN ai_providers p ON m.provider_id = p.id
      WHERE m.id = ?
    `).bind(id).first<{ model_id: string; provider_type: string; api_key: string; base_url: string | null }>()
    if (!row) throw new HTTPException(404, { message: '模型不存在' })

    const start = Date.now()

    // Cloudflare Workers AI
    if (row.provider_type === 'cloudflare') {
      const result = await c.env.AI.run(
        row.model_id as Parameters<typeof c.env.AI.run>[0],
        { messages: [{ role: 'user', content: prompt }] },
      )
      c.executionCtx.waitUntil(recordAiUsage(c.env.DB, row.model_id, prompt, result).catch(() => undefined))
      const reply = typeof result === 'object' && result !== null && 'response' in result
        ? String((result as { response?: unknown }).response ?? '（无返回内容）')
        : '（无返回内容）'
      return c.json({ data: { reply, latencyMs: Date.now() - start } })
    }

    // Anthropic
    if (row.provider_type === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': row.api_key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: row.model_id,
          max_tokens: 256,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new HTTPException(502, { message: `调用失败：${res.status} ${text.slice(0, 300)}` })
      }
      const json = await res.json() as { content?: { text?: string }[] }
      const reply = json.content?.[0]?.text ?? '（无返回内容）'
      return c.json({ data: { reply, latencyMs: Date.now() - start } })
    }

    // OpenAI 或兼容接口
    const baseUrl = resolveOpenAIBase(row.base_url)
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${row.api_key}`,
        'content-type': 'application/json',
      },
      // 不传 max_tokens / max_completion_tokens：不同模型支持的参数名不同，
      // 省略该参数可避免 400 报错，测试场景用模型默认值即可
      body: JSON.stringify({
        model: row.model_id,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new HTTPException(502, { message: `调用失败：${res.status} ${text.slice(0, 300)}` })
    }
    const json = await res.json() as { choices?: { message?: { content?: string } }[] }
    const reply = json.choices?.[0]?.message?.content ?? '（无返回内容）'
    return c.json({ data: { reply, latencyMs: Date.now() - start } })
  },
)
