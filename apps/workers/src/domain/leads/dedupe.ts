// 外部提交线索的去重：30 天内同一联系方式已有线索时，不新建，合并到已有线索
// 合并时在已有线索上写一条系统跟进记录（新留言、意向服务、来源页面），补充意向服务与访客关联，并提醒负责人
import type { Actor, Deps } from '../actor'
import { insertSystemActivityStatement } from '../activities/records'
import { linkVisitorStatement, parseVisitorId } from '../tracking/link'
import type { CreateLeadInput } from './service'

export const DEDUPE_DAYS = 30

/** 联系方式整理成比较用的形式：电话只保留数字（去掉 +86 / 0086），其它转小写、去空格 */
export function contactKey(contact: string): string {
  const s = contact.trim().toLowerCase()
  if (/^[+\d\s\-()]+$/.test(s)) {
    const digits = s.replace(/\D/g, '')
    if (digits.length >= 7) return digits.replace(/^(0086|86)(?=1\d{10}$)/, '')
  }
  return s.replace(/\s+/g, '')
}

interface ExistingLead { id: string; contact_info: string; assigned_to_userId: string | null; visitor_id: string | null; intended_services: string | null }

/** 查找 30 天内同一联系方式的线索（未删除，取最早的一条） */
export async function findDuplicateLead(db: D1Database, contact: string): Promise<ExistingLead | null> {
  const key = contactKey(contact)
  if (!key) return null
  const isPhone = /^\d{7,}$/.test(key)
  // 先用数据库粗筛（电话按末 7 位，其它按小写全文），再在这里精确比较
  const rows = await db.prepare(`
    SELECT id, contact_info, assigned_to_userId, visitor_id, intended_services FROM leads
    WHERE deleted_at IS NULL AND created_at >= datetime('now', ?)
      AND ${isPhone
        ? "REPLACE(REPLACE(REPLACE(REPLACE(contact_info, ' ', ''), '-', ''), '(', ''), ')', '') LIKE ?"
        : "REPLACE(LOWER(TRIM(contact_info)), ' ', '') = ?"}
    ORDER BY created_at LIMIT 20`,
  ).bind(`-${DEDUPE_DAYS} days`, isPhone ? `%${key.slice(-7)}` : key).all<ExistingLead>()
  return rows.results.find((r) => contactKey(r.contact_info) === key) ?? null
}

const parseServices = (v: string | null): string[] => {
  try { const a = JSON.parse(v ?? '[]') as unknown; return Array.isArray(a) ? a.map(String) : [] } catch { return [] }
}

/** 合并到已有线索：写系统跟进记录、补充意向服务与访客关联、提醒负责人 */
export async function mergeIntoLead(deps: Deps, actor: Actor, existing: ExistingLead, lead: CreateLeadInput): Promise<void> {
  const lines = [`客户再次提交（来源：${lead.source}）`, `姓名：${lead.name}；联系方式：${lead.contactInfo}`]
  if (lead.intendedServices.length > 0) lines.push(`意向服务：${lead.intendedServices.join('、')}`)
  if (lead.notes) lines.push(lead.notes)
  if (lead.adInfo?.url) lines.push(`页面：${lead.adInfo.url}`)

  const current = parseServices(existing.intended_services)
  const services = [...new Set([...current, ...lead.intendedServices])]
  const visitorId = parseVisitorId(lead.visitorId)
  const linkVisitor = visitorId && !existing.visitor_id ? visitorId : null

  const stmts: D1PreparedStatement[] = [insertSystemActivityStatement(deps.db, { leadId: existing.id }, actor.userId, lines.join('\n'))]
  if (services.length !== current.length || linkVisitor) {
    stmts.push(deps.db.prepare(
      'UPDATE leads SET intended_services = ?, visitor_id = COALESCE(visitor_id, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).bind(JSON.stringify(services), linkVisitor, existing.id))
  }
  if (linkVisitor) stmts.push(linkVisitorStatement(deps.db, linkVisitor, existing.id))
  await deps.db.batch(stmts)

  if (existing.assigned_to_userId) {
    try {
      await deps.env.NOTIFICATION_QUEUE.send({ type: 'lead_resubmitted', leadId: existing.id, assignedToUserId: existing.assigned_to_userId })
    } catch (err) {
      console.error(`[leads] 推送再次提交提醒失败 ${existing.id}:`, err)
    }
  }
}
