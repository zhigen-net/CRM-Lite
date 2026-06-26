// 共用 AI 调用工具

interface AiCallResult {
  content: string
  modelDisplayName: string
}

function resolveOpenAIBase(baseUrl: string | null): string {
  return (baseUrl ?? '').replace(/\/$/, '') || 'https://api.openai.com/v1'
}

export async function callAiModel(
  env: Env,
  modelId: string | null | undefined,
  systemPrompt: string,
  userPrompt: string,
): Promise<AiCallResult> {
  let row: { model_id: string; display_name: string; provider_type: string; api_key: string; base_url: string | null } | null = null

  if (modelId) {
    row = await env.DB.prepare(`
      SELECT m.model_id, m.display_name, p.provider_type, p.api_key, p.base_url
      FROM ai_models m JOIN ai_providers p ON m.provider_id = p.id
      WHERE m.id = ? AND m.is_enabled = 1 AND p.is_active = 1
    `).bind(modelId).first()
  }

  if (!row) {
    row = await env.DB.prepare(`
      SELECT m.model_id, m.display_name, p.provider_type, p.api_key, p.base_url
      FROM ai_models m JOIN ai_providers p ON m.provider_id = p.id
      WHERE m.is_enabled = 1 AND p.is_active = 1
      ORDER BY m.created_at ASC
      LIMIT 1
    `).first()
  }

  if (!row) throw new Error('未配置可用的 AI 模型，请在系统管理 → AI 模型中启用至少一个模型')

  // Cloudflare Workers AI（原生绑定，无需 API Key）
  if (row.provider_type === 'cloudflare') {
    if (!env.AI) {
      throw new Error('Cloudflare Workers AI 绑定未启用，请确认 wrangler.toml 中已配置 [ai] binding 并重新部署 Worker')
    }
    let cfResult: unknown
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cfResult = await (env.AI as any).run(row.model_id, {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      })
    } catch (e) {
      throw new Error(`Cloudflare AI 调用失败（${row.model_id}）：${e instanceof Error ? e.message : String(e)}`)
    }
    const content = typeof cfResult === 'object' && cfResult !== null && 'response' in cfResult
      ? String((cfResult as { response?: unknown }).response ?? '')
      : ''
    return { content, modelDisplayName: row.display_name }
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
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`AI 调用失败：${res.status} ${text.slice(0, 200)}`)
    }
    const json = await res.json() as { content?: { text?: string }[] }
    return { content: json.content?.[0]?.text ?? '', modelDisplayName: row.display_name }
  }

  // OpenAI 兼容接口（openai / custom）
  const baseUrl = resolveOpenAIBase(row.base_url)
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${row.api_key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: row.model_id,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`AI 调用失败：${res.status} ${text.slice(0, 200)}`)
  }
  const json = await res.json() as { choices?: { message?: { content?: string } }[] }
  return { content: json.choices?.[0]?.message?.content ?? '', modelDisplayName: row.display_name }
}

// 提取 AI 回复中的 JSON（处理被 markdown 代码块包裹的情况）
export function extractJson(text: string): string {
  const md = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  return md ? md[1]!.trim() : text.trim()
}
