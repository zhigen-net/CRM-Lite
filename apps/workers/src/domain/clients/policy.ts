// 客户的访问规则：可见范围与修改权限只在这里定义
import type { Actor } from '../actor'
import { forbidden } from '../errors'

interface ClientOwnership {
  assigned_sales_userId: string | null
}

/** 可见范围的查询条件（拼在 WHERE 之后）。销售：分配给自己的客户；其它角色：全部 */
export function clientVisibility(actor: Actor, alias = 'c'): { sql: string; params: unknown[] } {
  if (actor.role !== 'sales') return { sql: '', params: [] }
  return { sql: ` AND ${alias}.assigned_sales_userId = ?`, params: [actor.userId] }
}

export function canViewClient(actor: Actor, client: ClientOwnership): boolean {
  return actor.role !== 'sales' || client.assigned_sales_userId === actor.userId
}

export function assertCanViewClient(actor: Actor, client: ClientOwnership): void {
  if (!canViewClient(actor, client)) throw forbidden('无权访问此客户')
}

/** 修改：销售只能改分配给自己的客户 */
export function assertCanEditClient(actor: Actor, client: ClientOwnership): void {
  if (actor.role === 'sales' && client.assigned_sales_userId !== actor.userId) throw forbidden('无权操作此客户')
}
