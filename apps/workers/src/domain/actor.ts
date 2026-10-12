// 操作者：业务服务层只认这个对象，不关心请求来自哪个入口
import type { CrmJwtPayload } from '../shared/jwt'

export type Role = 'admin' | 'operations' | 'sales'

/** 请求来源，用于日志、审计，以及避免工作流循环触发 */
export type Channel = 'web' | 'api' | 'assistant' | 'workflow'

export interface Actor {
  userId: string
  role: Role
  teamId: string | null
  via: Channel
}

export function actorFromJwt(payload: Pick<CrmJwtPayload, 'userId' | 'role' | 'teamId'>, via: Channel): Actor {
  return { userId: payload.userId, role: payload.role, teamId: payload.teamId ?? null, via }
}

/** 业务服务需要的运行时依赖；waitUntil 用于不阻塞响应的后台任务（如工作流） */
export interface Deps {
  db: D1Database
  env: Env
  waitUntil(promise: Promise<unknown>): void
}
