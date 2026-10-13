// 工作流对线索/客户字段的修改：统一走业务服务层，保证线索数等附带处理一致
import type { Actor, Deps } from './actor'
import { updateLead, type UpdateLeadPatch } from './leads/service'
import { updateClient, type UpdateClientPatch } from './clients/service'

/** 工作流以系统身份执行（等同管理员权限；不写变更记录、不再触发工作流） */
export const WORKFLOW_ACTOR: Actor = { userId: 'system', role: 'admin', teamId: null, via: 'workflow' }

const emptyToNull = (v: string) => (v.trim() === '' ? null : v)
const toList = (v: string) => v.split(/[、,，]/).map((s) => s.trim()).filter(Boolean)

/** 字段值（模板插值后的字符串）→ 线索修改参数；不支持的字段返回 null */
function leadPatch(field: string, value: string): UpdateLeadPatch | null {
  switch (field) {
    case 'status': return { status: value }
    case 'lostReason': return { lostReason: emptyToNull(value) }
    case 'source': return { source: value }
    case 'assignedToUserId': return { assignedToUserId: emptyToNull(value) }
    case 'assignedToTeamId': return { assignedToTeamId: emptyToNull(value) }
    case 'intendedServices': return { intendedServices: toList(value) }
    case 'nextContactDate': return { nextContactDate: emptyToNull(value) }
    case 'notes': return { notes: value }
    case 'contactInfo': return { contactInfo: value }
    default: return null
  }
}

function clientPatch(field: string, value: string): UpdateClientPatch | null {
  switch (field) {
    case 'contractStatus': return { contractStatus: emptyToNull(value) }
    case 'assignedSalesUserId': return { assignedSalesUserId: emptyToNull(value) }
    case 'name': return { name: value }
    case 'email': return { email: emptyToNull(value) }
    case 'phone': return { phone: emptyToNull(value) }
    case 'nextContactDate': return { nextContactDate: emptyToNull(value) }
    default: return null
  }
}

/** 工作流修改一个字段。返回 false 表示该实体不支持此字段（调用方跳过） */
export async function applyWorkflowFieldUpdate(
  db: D1Database, env: Env, entityType: string, entityId: string, field: string, value: string,
): Promise<boolean> {
  const deps: Deps = { db, env, waitUntil: (p) => { p.catch((err) => console.error('[workflow] background task failed:', err)) } }
  if (entityType === 'lead') {
    const patch = leadPatch(field, value)
    if (!patch) return false
    await updateLead(deps, WORKFLOW_ACTOR, entityId, patch)
    return true
  }
  if (entityType === 'client') {
    const patch = clientPatch(field, value)
    if (!patch) return false
    await updateClient(deps, WORKFLOW_ACTOR, entityId, patch)
    return true
  }
  return false
}
