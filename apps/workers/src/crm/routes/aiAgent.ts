import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { requireAuth } from '../middleware/auth'
import { CRM_TOOLS, ToolDef } from '../agent/tools'
import { executeTool, AgentContext } from '../agent/executor'
import { getIndustryContext, industryContextBlock } from '../../domain/templates'

export const aiAgentRoutes = new Hono<{ Bindings: Env }>()

// 本路由挂载在 /api 根路径下：不能用 use('*')，否则会拦截所有 /api/* 请求（包括客户门户），
// 因此逐个接口挂 requireAuth

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string(), z.array(z.record(z.unknown()))]),
})

// 系统提示词：每次请求生成，带上当天日期和业务背景（系统设置中配置）
const buildSystemPrompt = (industryContext: string) => `你是一个 CRM 智能助手，帮助用户管理线索和客户。

你的能力：
- 查询、筛选线索和客户（支持按状态、下次联系时间、姓名等）
- 为线索/客户创建跟进记录（电话、会面、备注等）
- 安排下次联系时间
- 更新线索状态、客户合同状态
- 分配负责人
- 查询待跟进、已逾期的线索/客户

操作规范：
1. 执行状态变更前，先用 get_options 确认有效值
2. 对单个实体操作前，先用 get_lead/get_client 了解当前状态
3. 所有重要操作配合 create_activity 留下记录
4. 查询到多条结果时，简洁列出关键字段（姓名、状态、下次联系时间），不要堆砌所有字段
5. 不确定用户意图时主动询问，不要假设

日期参考：今天是 ${new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}

回复语言：中文，简洁直接。${industryContextBlock(industryContext)}`

// ─── Anthropic tool-use 循环 ──────────────────────────────────────────────────

async function runAnthropicAgent(
  apiKey: string, modelId: string,
  messages: unknown[], agentCtx: AgentContext, systemPrompt: string,
): Promise<string> {
  const msgList = [...messages]

  for (let round = 0; round < 10; round++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId, max_tokens: 2048,
        system: systemPrompt, tools: CRM_TOOLS, messages: msgList,
      }),
    })
    if (!res.ok) throw new Error(`Anthropic 调用失败：${(await res.text()).slice(0, 200)}`)

    const json = await res.json() as {
      stop_reason: string
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      >
    }
    msgList.push({ role: 'assistant', content: json.content })

    if (json.stop_reason !== 'tool_use') {
      return json.content.filter((b) => b.type === 'text').map((b) => (b as { type: 'text'; text: string }).text).join('')
    }

    const toolUseBlocks = json.content.filter((b) => b.type === 'tool_use') as Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }>
    const toolResults = await Promise.all(toolUseBlocks.map(async (block) => {
      let result: unknown
      try { result = await executeTool(agentCtx, block.name, block.input) }
      catch (err) { result = { error: `工具执行异常：${err instanceof Error ? err.message : String(err)}` } }
      return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) }
    }))
    msgList.push({ role: 'user', content: toolResults })
  }
  return '（超出最大轮次限制）'
}

// ─── OpenAI 兼容 tool-use 循环 ───────────────────────────────────────────────

function toOpenAiTools(tools: ToolDef[]) {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }))
}

async function runOpenAiAgent(
  apiKey: string, baseUrl: string | null, modelId: string,
  messages: unknown[], agentCtx: AgentContext, systemPrompt: string,
): Promise<string> {
  const base = (baseUrl ?? '').replace(/\/$/, '') || 'https://api.openai.com/v1'

  // OpenAI 消息格式：仅支持 string content，将 Anthropic 格式转换
  const toOAI = (msgs: unknown[]) => msgs.map((m) => {
    const msg = m as { role: string; content: unknown }
    if (typeof msg.content === 'string') return msg
    // tool_result blocks → role:tool messages
    if (Array.isArray(msg.content)) {
      const toolResults = (msg.content as Array<{ type?: string; tool_use_id?: string; content?: string; tool_call_id?: string }>)
        .filter((b) => b.type === 'tool_result')
      if (toolResults.length) {
        return toolResults.map((b) => ({ role: 'tool', tool_call_id: b.tool_use_id ?? b.tool_call_id, content: b.content ?? '' }))
      }
    }
    return msg
  }).flat()

  const msgList: unknown[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ]

  for (let round = 0; round < 10; round++) {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: modelId, max_completion_tokens: 2048,
        tools: toOpenAiTools(CRM_TOOLS), tool_choice: 'auto',
        messages: toOAI(msgList),
      }),
    })
    if (!res.ok) throw new Error(`OpenAI 调用失败：${(await res.text()).slice(0, 200)}`)

    const json = await res.json() as {
      choices: Array<{
        finish_reason: string
        message: {
          role: string; content: string | null
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>
        }
      }>
    }

    const choice = json.choices[0]
    if (!choice) throw new Error('AI 返回结果为空')

    msgList.push(choice.message)

    if (choice.finish_reason !== 'tool_calls' || !choice.message.tool_calls?.length) {
      return choice.message.content ?? ''
    }

    const toolResults = await Promise.all(choice.message.tool_calls.map(async (tc) => {
      let result: unknown
      try {
        const toolInput = JSON.parse(tc.function.arguments) as Record<string, unknown>
        result = await executeTool(agentCtx, tc.function.name, toolInput)
      } catch (err) {
        result = { error: `工具执行异常：${err instanceof Error ? err.message : String(err)}` }
      }
      return { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) }
    }))
    msgList.push(...toolResults)
  }
  return '（超出最大轮次限制）'
}

// ─── POST /api/ai-agent/chat ─────────────────────────────────────────────────

aiAgentRoutes.post(
  '/ai-agent/chat', requireAuth,
  zValidator('json', z.object({
    messages: z.array(messageSchema).min(1).max(50),
  })),
  async (c) => {
    const { messages } = c.req.valid('json')
    const { userId, role, teamId } = c.get('jwtPayload')

    const modelRow = await c.env.DB.prepare(`
      SELECT m.model_id, m.display_name, p.provider_type, p.api_key, p.base_url
      FROM ai_models m JOIN ai_providers p ON m.provider_id = p.id
      WHERE m.is_enabled = 1 AND p.is_active = 1
      ORDER BY m.created_at ASC LIMIT 1
    `).first<{ model_id: string; display_name: string; provider_type: string; api_key: string; base_url: string | null }>()

    if (!modelRow) throw new HTTPException(400, { message: '未配置可用的 AI 模型' })

    const agentCtx: AgentContext = {
      db: c.env.DB, env: c.env, userId, role, teamId: teamId ?? null,
      waitUntil: (p) => c.executionCtx.waitUntil(p),
    }
    const systemPrompt = buildSystemPrompt(await getIndustryContext(c.env.DB))

    try {
      let finalText: string
      if (modelRow.provider_type === 'cloudflare') {
        // Cloudflare Workers AI 不支持 tool_use，降级为单轮对话
        const userMsg = messages.filter((m) => m.role === 'user').at(-1)
        const userText = typeof userMsg?.content === 'string' ? userMsg.content : JSON.stringify(userMsg?.content ?? '')
        const result = await c.env.AI.run(
          modelRow.model_id as Parameters<typeof c.env.AI.run>[0],
          {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userText },
            ],
          },
        )
        finalText = typeof result === 'object' && result !== null && 'response' in result
          ? String((result as { response?: unknown }).response ?? '')
          : ''
      } else if (modelRow.provider_type === 'anthropic') {
        finalText = await runAnthropicAgent(modelRow.api_key, modelRow.model_id, messages, agentCtx, systemPrompt)
      } else {
        finalText = await runOpenAiAgent(modelRow.api_key, modelRow.base_url, modelRow.model_id, messages, agentCtx, systemPrompt)
      }
      return c.json({ data: { message: finalText, model: modelRow.display_name } })
    } catch (err) {
      throw new HTTPException(502, { message: err instanceof Error ? err.message : 'AI 调用失败' })
    }
  },
)
