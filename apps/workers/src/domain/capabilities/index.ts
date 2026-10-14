// 能力注册表：所有对 AI 开放的能力在这里登记一次。
// 各入口（AI 助手、MCP、以后的其它 Agent 接口）只负责鉴权、确定 Actor 和可用 scope，然后调用 invokeCapability。
import type { Actor, Deps } from '../actor'
import { recordAudit, shouldAudit } from '../audit'
import { DomainError, forbidden, notFound } from '../errors'
import { createActivity } from './activities'
import { getClient, queryClients, updateClient } from './clients'
import { getLead, queryLeads, updateLead } from './leads'
import { getOptions, queryUsers } from './meta'
import type { Capability, CapabilityInput, Scope } from './types'
import { validateInput } from './validate'

export type { Capability, CapabilityInput, InputSchema, Scope } from './types'
export { SCOPES } from './types'

export const CAPABILITIES: readonly Capability[] = [
  queryLeads, getLead, queryClients, getClient,
  createActivity, updateLead, updateClient,
  getOptions, queryUsers,
]

const BY_NAME = new Map(CAPABILITIES.map((c) => [c.name, c]))

export function getCapability(name: string): Capability | undefined {
  return BY_NAME.get(name)
}

/** 按授权的 scope 过滤可用能力；不传 scopes 表示不额外限制（只受用户角色权限约束） */
export function capabilitiesFor(scopes?: readonly Scope[]): Capability[] {
  return scopes ? CAPABILITIES.filter((c) => scopes.includes(c.scope)) : [...CAPABILITIES]
}

/** 审计用的操作对象：按约定的参数名推断 */
function targetOf(cap: Capability, input: CapabilityInput) {
  if (typeof input.entityId === 'string') {
    return { targetType: input.entityType === 'client' ? 'client' as const : 'lead' as const, targetId: input.entityId }
  }
  if (typeof input.id === 'string') {
    return { targetType: cap.name.includes('client') ? 'client' as const : 'lead' as const, targetId: input.id }
  }
  return {}
}

/**
 * 调用能力：查找 → 检查 scope → 校验输入 → 执行 → 按需记录审计日志。
 * 业务错误抛 DomainError，由入口转换为各自的返回格式。
 */
export async function invokeCapability(
  deps: Deps, actor: Actor, name: string, input: unknown, scopes?: readonly Scope[],
): Promise<unknown> {
  const cap = BY_NAME.get(name)
  if (!cap) throw notFound(`未知工具：${name}`)
  if (scopes && !scopes.includes(cap.scope)) throw forbidden(`当前授权不包含 ${cap.scope}，无法调用 ${name}`)
  const valid = validateInput(cap.inputSchema, input)
  const audit = shouldAudit(actor, cap.readOnly)
  try {
    const result = await cap.run(deps, actor, valid)
    if (audit) recordAudit(deps, actor, { action: name, status: 'ok', input: valid, ...targetOf(cap, valid) })
    return result
  } catch (err) {
    if (audit && err instanceof DomainError) {
      recordAudit(deps, actor, { action: name, status: 'error', input: valid, error: err.message, ...targetOf(cap, valid) })
    }
    throw err
  }
}
