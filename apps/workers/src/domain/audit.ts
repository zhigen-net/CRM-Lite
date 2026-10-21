// 审计日志：记录非界面入口（对外接口、AI 助手、MCP）发生的调用，供管理员追查
// 这里记的是「调用」本身；数据的改动另由 operationLog.ts 记录（所有入口都记）
import type { Actor, Deps } from './actor'
import { classifyAction } from './operationLog'

export interface AuditEntry {
  action: string
  status: 'ok' | 'error'
  targetType?: 'lead' | 'client' | undefined
  targetId?: string | null | undefined
  input?: unknown
  error?: string | undefined
}

const INPUT_LIMIT = 1000

/** 是否需要记录：写操作在所有非界面入口都记录；读操作只在外部入口（API Key、MCP）记录 */
export function shouldAudit(actor: Actor, readOnly: boolean): boolean {
  if (actor.via === 'web' || actor.via === 'workflow') return false
  return !readOnly || actor.via === 'api' || actor.via === 'mcp'
}

/** 后台写入，不阻塞响应；写入失败只打日志 */
export function recordAudit(deps: Deps, actor: Actor, entry: AuditEntry): void {
  const input = entry.input === undefined ? null : JSON.stringify(entry.input).slice(0, INPUT_LIMIT)
  deps.waitUntil(
    deps.db.prepare(
      `INSERT INTO audit_log (id, user_id, api_key_id, via, action, category, target_type, target_id, input_summary, status, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), actor.userId, actor.apiKeyId ?? null, actor.via, entry.action, classifyAction(entry.action).category,
      entry.targetType ?? null, entry.targetId ?? null, input, entry.status, entry.error?.slice(0, 500) ?? null,
    ).run().catch((err) => console.error('[audit] write failed:', err)),
  )
}
