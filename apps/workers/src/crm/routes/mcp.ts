// MCP 服务（Model Context Protocol）：POST /api/mcp
// 无状态 Streamable HTTP：每个请求独立处理、只返回 JSON，不建立 SSE 流、不保存会话。
// 鉴权用 API Key（X-API-Key 或 Authorization: Bearer），工具列表与权限由能力注册表和密钥的 scopes 决定。
import { Hono } from 'hono'
import { requireApiKey } from '../middleware/apiKeyAuth'
import { actorFromJwt } from '../../domain/actor'
import { capabilitiesFor, invokeCapability, type Capability, type Scope } from '../../domain/capabilities'
import { DomainError } from '../../domain/errors'
import { getIndustryContext, industryContextBlock } from '../../domain/templates'

export const mcpRoutes = new Hono<{ Bindings: Env }>()

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const SERVER_INFO = { name: 'crm', title: 'CRM', version: '1.0.0' }

const INSTRUCTIONS = `这是 CRM 系统的 MCP 服务，可以查询和维护线索、客户与跟进记录。
使用规范：
1. 先调用 whoami 了解当前身份和可用权限；销售只能看到自己负责的数据。
2. 修改状态、合同状态、跟进类型前，先用 get_options 确认有效值。
3. 对单个线索/客户操作前，先用 get_lead / get_client 了解现状。
4. 重要变更同时用 create_activity 留下跟进记录。
5. 新建线索前先用 query_leads 按联系方式查重。
6. 联系方式可能已打码（密钥没有 contacts:read 权限），不要据此推测完整号码。`

type JsonRpcId = string | number | null
interface JsonRpcRequest { jsonrpc?: string; id?: JsonRpcId; method?: string; params?: Record<string, unknown> }

const rpcResult = (id: JsonRpcId, result: unknown) => ({ jsonrpc: '2.0', id, result })
const rpcError = (id: JsonRpcId, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } })

function toMcpTool(cap: Capability) {
  return {
    name: cap.name,
    description: cap.description,
    inputSchema: cap.inputSchema,
    annotations: { readOnlyHint: cap.readOnly, destructiveHint: false, idempotentHint: cap.readOnly, openWorldHint: false },
  }
}

interface McpContext {
  deps: { db: D1Database; env: Env; waitUntil(p: Promise<unknown>): void }
  actor: ReturnType<typeof actorFromJwt>
  scopes: Scope[]
}

/** 处理单条 JSON-RPC 消息；通知（没有 id）返回 null */
async function handleMessage(ctx: McpContext, msg: JsonRpcRequest): Promise<unknown | null> {
  const isNotification = msg.id === undefined
  const id = msg.id ?? null
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return isNotification ? null : rpcError(id, -32600, 'Invalid Request')
  }
  if (isNotification) return null // notifications/initialized 等无需响应

  switch (msg.method) {
    case 'initialize': {
      const requested = msg.params?.protocolVersion
      const protocolVersion = typeof requested === 'string' && SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0]
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS + industryContextBlock(await getIndustryContext(ctx.deps.db)),
      })
    }
    case 'ping':
      return rpcResult(id, {})
    case 'tools/list':
      return rpcResult(id, { tools: capabilitiesFor(ctx.scopes).map(toMcpTool) })
    case 'tools/call': {
      const name = msg.params?.name
      if (typeof name !== 'string') return rpcError(id, -32602, '缺少工具名 name')
      try {
        const result = await invokeCapability(ctx.deps, ctx.actor, name, msg.params?.arguments ?? {}, ctx.scopes)
        return rpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          ...(result && typeof result === 'object' && !Array.isArray(result) ? { structuredContent: result } : {}),
        })
      } catch (err) {
        // 业务错误（无权限、参数错误、不存在）作为工具错误返回，让模型能据此调整
        if (err instanceof DomainError) {
          return rpcResult(id, { content: [{ type: 'text', text: err.message }], isError: true })
        }
        console.error('[mcp] tool failed:', name, err)
        return rpcError(id, -32603, '服务器内部错误')
      }
    }
    default:
      return rpcError(id, -32601, `不支持的方法：${msg.method}`)
  }
}

mcpRoutes.post('/', requireApiKey, async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json(rpcError(null, -32700, 'Parse error'), 400)
  }

  const ctx: McpContext = {
    deps: { db: c.env.DB, env: c.env, waitUntil: (p) => c.executionCtx.waitUntil(p) },
    actor: actorFromJwt(c.get('jwtPayload'), 'mcp', c.get('apiKey').id),
    scopes: c.get('apiKey').scopes,
  }

  const messages = Array.isArray(body) ? body : [body]
  const responses = (await Promise.all(messages.map((m) => handleMessage(ctx, (m ?? {}) as JsonRpcRequest))))
    .filter((r) => r !== null)

  // 只有通知时按规范返回 202、无响应体
  if (responses.length === 0) return c.body(null, 202)
  return c.json(Array.isArray(body) ? responses : responses[0])
})

// 不提供服务端推送流和会话
mcpRoutes.on(['GET', 'DELETE'], '/', (c) => c.json({ message: '只支持 POST（无状态 Streamable HTTP）' }, 405, { Allow: 'POST' }))
