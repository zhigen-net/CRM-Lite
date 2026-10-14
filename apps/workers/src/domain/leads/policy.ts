// 线索的访问规则：可见范围与修改权限只在这里定义
import type { Actor } from '../actor'
import { forbidden } from '../errors'

interface LeadOwnership {
  assigned_to_userId: string | null
  assigned_to_teamId: string | null
}

/**
 * 可见范围的查询条件（拼在 WHERE 之后）。
 * 销售：分配给自己的，以及本团队尚未分配给具体人的；其它角色：全部。
 */
export function leadVisibility(actor: Actor, alias = 'l'): { sql: string; params: unknown[] } {
  if (actor.role !== 'sales') return { sql: '', params: [] }
  return {
    sql: ` AND (${alias}.assigned_to_userId = ? OR (${alias}.assigned_to_userId IS NULL AND ${alias}.assigned_to_teamId = ?))`,
    params: [actor.userId, actor.teamId],
  }
}

export function canViewLead(actor: Actor, lead: LeadOwnership): boolean {
  if (actor.role !== 'sales') return true
  if (lead.assigned_to_userId === actor.userId) return true
  return !lead.assigned_to_userId && lead.assigned_to_teamId === actor.teamId
}

export function assertCanViewLead(actor: Actor, lead: LeadOwnership): void {
  if (!canViewLead(actor, lead)) throw forbidden('无权访问此线索')
}

/** 修改：销售只能改分配给自己的线索（本团队未分配的线索只能看，不能改） */
export function assertCanEditLead(actor: Actor, lead: LeadOwnership): void {
  if (actor.role === 'sales' && lead.assigned_to_userId !== actor.userId) {
    throw forbidden('无权操作此线索')
  }
}

/** 变更线索所属团队：仅管理员 */
export function assertCanChangeLeadTeam(actor: Actor): void {
  if (actor.role !== 'admin') throw forbidden('只有管理员可以变更线索所属团队')
}
