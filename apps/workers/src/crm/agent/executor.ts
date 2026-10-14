// AI 助手的工具执行：以当前登录用户身份调用能力注册表，规则全部在 domain 层
import { actorFromJwt, type Role } from '../../domain/actor'
import { invokeCapability } from '../../domain/capabilities'
import { DomainError } from '../../domain/errors'

export interface AgentContext {
  db: D1Database
  env: Env
  userId: string
  role: Role
  teamId: string | null
  waitUntil(promise: Promise<unknown>): void
}

export async function executeTool(ctx: AgentContext, toolName: string, input: Record<string, unknown>): Promise<unknown> {
  try {
    return await invokeCapability(
      { db: ctx.db, env: ctx.env, waitUntil: ctx.waitUntil },
      actorFromJwt(ctx, 'assistant'),
      toolName,
      input,
    )
  } catch (err) {
    // 业务错误（无权限、参数无效等）以 { error } 返回给模型，让它能据此调整
    if (err instanceof DomainError) return { error: err.message }
    throw err
  }
}
