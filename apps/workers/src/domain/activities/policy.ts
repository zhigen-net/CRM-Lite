// 跟进记录的访问规则：可见范围，以及写跟进记录前对关联线索/客户的权限检查
import type { Actor } from '../actor'
import { assertCanEditLead } from '../leads/policy'
import { assertCanEditClient } from '../clients/policy'

/**
 * 可见范围的查询条件（拼在 WHERE 之后；需要 l = leads、c = clients 的 LEFT JOIN）。
 * 销售：自己负责的线索或客户下的跟进记录；其它角色：全部
 */
export function activityVisibility(actor: Actor): { sql: string; params: unknown[] } {
  if (actor.role !== 'sales') return { sql: '', params: [] }
  return { sql: ' AND (l.assigned_to_userId = ? OR c.assigned_sales_userId = ?)', params: [actor.userId, actor.userId] }
}

/** 写跟进记录会改写关联对象的下次联系时间，因此要求对关联的线索/客户有修改权限 */
export function assertCanWriteActivity(
  actor: Actor,
  lead: { assigned_to_userId: string | null; assigned_to_teamId: string | null } | null,
  client: { assigned_sales_userId: string | null } | null,
): void {
  if (lead) assertCanEditLead(actor, lead)
  if (client) assertCanEditClient(actor, client)
}
