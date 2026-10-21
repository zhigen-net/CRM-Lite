// 外部提交线索的去重：30 天内同一联系方式已有线索时，不新建，合并到已有线索
// 合并时在已有线索上写一条系统跟进记录（新留言、意向服务、来源页面），补充意向服务与访客关联，并提醒负责人
// 10 分钟内没有新内容的重复提交（连点、刷新重发）直接忽略；同一联系方式同时提交时用锁保证只建一条
import type { Actor, Deps } from '../actor'
import { insertSystemActivityStatement } from '../activities/records'
import { canViewClient } from '../clients/policy'
import { linkVisitorStatement, parseVisitorId } from '../tracking/link'
import { canViewLead } from './policy'
import type { CreateLeadInput } from './service'

export const DEDUPE_DAYS = 30
export const REPEAT_MINUTES = 10
const LOCK_WAIT_MS = 200
const LOCK_TRIES = 25
const RESUBMIT_PREFIX = '客户再次提交'

/** 联系方式整理成比较用的形式：电话只保留数字（去掉 +86 / 0086），其它转小写、去空格 */
export function contactKey(contact: string): string {
  const s = contact.trim().toLowerCase()
  if (/^[+\d\s\-()]+$/.test(s)) {
    const digits = s.replace(/\D/g, '')
    if (digits.length >= 7) return digits.replace(/^(0086|86)(?=1\d{10}$)/, '')
  }
  return s.replace(/\s+/g, '')
}

const isPhoneKey = (key: string) => /^\d{7,}$/.test(key)
const STRIP_PHONE = (col: string) => `REPLACE(REPLACE(REPLACE(REPLACE(${col}, ' ', ''), '-', ''), '(', ''), ')', '')`

interface ExistingLead {
  id: string; contact_info: string; assigned_to_userId: string | null; visitor_id: string | null
  intended_services: string | null; notes: string | null; fresh: number
  client_id: string | null; client_owner: string | null
}

/** 查找 30 天内同一联系方式的线索（未删除，取最早的一条），带上转化后的客户 */
export async function findDuplicateLead(db: D1Database, contact: string): Promise<ExistingLead | null> {
  const key = contactKey(contact)
  if (!key) return null
  // 先用数据库粗筛（电话按末 7 位，其它按小写全文），再在这里精确比较
  const rows = await db.prepare(`
    SELECT l.id, l.contact_info, l.assigned_to_userId, l.visitor_id, l.intended_services, l.notes,
      (l.created_at >= datetime('now', ?)) AS fresh, c.id AS client_id, c.assigned_sales_userId AS client_owner
    FROM leads l LEFT JOIN clients c ON c.lead_id = l.id AND c.deleted_at IS NULL
    WHERE l.deleted_at IS NULL AND l.created_at >= datetime('now', ?)
      AND ${isPhoneKey(key) ? `${STRIP_PHONE('l.contact_info')} LIKE ?` : "REPLACE(LOWER(TRIM(l.contact_info)), ' ', '') = ?"}
    ORDER BY l.created_at LIMIT 20`,
  ).bind(`-${REPEAT_MINUTES} minutes`, `-${DEDUPE_DAYS} days`, isPhoneKey(key) ? `%${key.slice(-7)}` : key).all<ExistingLead>()
  return rows.results.find((r) => contactKey(r.contact_info) === key) ?? null
}

const parseServices = (v: string | null): string[] => {
  try { const a = JSON.parse(v ?? '[]') as unknown; return Array.isArray(a) ? a.map(String) : [] } catch { return [] }
}

/** 10 分钟内的重复提交：线索刚建或刚合并过，且没有新的意向服务、留言也已记录过 */
export async function isRepeatSubmission(db: D1Database, existing: ExistingLead, lead: CreateLeadInput): Promise<boolean> {
  const current = parseServices(existing.intended_services)
  if (lead.intendedServices.some((s) => !current.includes(s))) return false
  const recent = await db.prepare(
    `SELECT description FROM sales_activities
     WHERE lead_id = ? AND activity_type = 'System' AND description LIKE ? AND created_at >= datetime('now', ?)
     ORDER BY created_at DESC LIMIT 5`,
  ).bind(existing.id, `${RESUBMIT_PREFIX}%`, `-${REPEAT_MINUTES} minutes`).all<{ description: string }>()
  if (!existing.fresh && recent.results.length === 0) return false
  const note = lead.notes?.trim()
  if (!note) return true
  return (existing.notes ?? '').includes(note) || recent.results.some((r) => r.description.includes(note))
}

/** 合并到已有线索：写系统跟进记录、补充意向服务与访客关联、提醒负责人（已转化的同时提醒客户负责人） */
export async function mergeIntoLead(deps: Deps, actor: Actor, existing: ExistingLead, lead: CreateLeadInput): Promise<void> {
  const lines = [`${RESUBMIT_PREFIX}（来源：${lead.source}）`, `姓名：${lead.name}；联系方式：${lead.contactInfo}`]
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

  const recipients = new Map<string, string | undefined>()
  if (existing.client_owner) recipients.set(existing.client_owner, existing.client_id ?? undefined)
  if (existing.assigned_to_userId && !recipients.has(existing.assigned_to_userId)) recipients.set(existing.assigned_to_userId, undefined)
  for (const [userId, clientId] of recipients) {
    try {
      await deps.env.NOTIFICATION_QUEUE.send({
        type: 'lead_resubmitted', leadId: existing.id, assignedToUserId: userId, ...(clientId ? { clientId } : {}),
      })
    } catch (err) {
      console.error(`[leads] 推送再次提交提醒失败 ${existing.id}:`, err)
    }
  }
}

// ─── 并发锁 ──────────────────────────────────────────────────────────────────

/** 同一联系方式同时提交时排队执行（D1 写入串行，靠主键冲突抢锁）；锁超过 30 秒视为失效；等不到锁时照常执行 */
export async function withContactLock<T>(db: D1Database, contact: string, fn: () => Promise<T>): Promise<T> {
  const key = contactKey(contact)
  const acquire = async () => (await db.prepare(
    `INSERT INTO lead_submit_locks (contact_key, locked_at) VALUES (?, datetime('now'))
     ON CONFLICT(contact_key) DO UPDATE SET locked_at = excluded.locked_at WHERE locked_at < datetime('now', '-30 seconds')`,
  ).bind(key).run()).meta.changes > 0
  let locked = false
  for (let i = 0; key && i < LOCK_TRIES; i++) {
    if ((locked = await acquire())) break
    await new Promise((r) => setTimeout(r, LOCK_WAIT_MS))
  }
  try {
    return await fn()
  } finally {
    if (locked) await db.prepare('DELETE FROM lead_submit_locks WHERE contact_key = ?').bind(key).run().catch(() => undefined)
  }
}

// ─── 相同联系方式的历史记录 ──────────────────────────────────────────────────

export interface ContactMatch {
  type: 'lead' | 'client'
  id: string
  leadNo: number | null
  name: string
  status: string | null
  ownerUserId: string | null
  ownerTeamId: string | null
  ownerName: string | null
  createdAt: string
}

/** 不限时间查找相同联系方式的线索和客户（未删除）；已转化的线索换成对应客户 */
export async function findContactMatches(db: D1Database, contact: string, excludeLeadId?: string): Promise<ContactMatch[]> {
  const key = contactKey(contact)
  if (!key) return []
  const phone = isPhoneKey(key)
  const pattern = phone ? `%${key.slice(-7)}` : key
  const leads = await db.prepare(`
    SELECT l.id, l.lead_no, l.name, l.status, l.contact_info AS contact, l.assigned_to_userId AS owner, l.assigned_to_teamId AS team,
      u.name AS owner_name, l.created_at, c.id AS client_id
    FROM leads l LEFT JOIN users u ON u.id = l.assigned_to_userId
      LEFT JOIN clients c ON c.lead_id = l.id AND c.deleted_at IS NULL
    WHERE l.deleted_at IS NULL AND l.id != ?
      AND ${phone ? `${STRIP_PHONE('l.contact_info')} LIKE ?` : "REPLACE(LOWER(TRIM(l.contact_info)), ' ', '') = ?"}
    ORDER BY l.created_at DESC LIMIT 20`,
  ).bind(excludeLeadId ?? '', pattern).all<{
    id: string; lead_no: number | null; name: string; status: string; contact: string; owner: string | null; team: string | null
    owner_name: string | null; created_at: string; client_id: string | null
  }>()
  const matchedLeads = leads.results.filter((r) => contactKey(r.contact) === key)
  const clientIds = matchedLeads.map((r) => r.client_id).filter((v): v is string => !!v)

  const clientWhere = [phone ? `${STRIP_PHONE("COALESCE(c.phone, '')")} LIKE ?` : "LOWER(TRIM(COALESCE(c.email, ''))) = ?"]
  const clientParams: unknown[] = [pattern]
  if (clientIds.length > 0) {
    clientWhere.push(`c.id IN (${clientIds.map(() => '?').join(',')})`)
    clientParams.push(...clientIds)
  }
  const clients = await db.prepare(`
    SELECT c.id, c.name, c.phone, c.email, c.contract_status, c.assigned_sales_userId AS owner, u.name AS owner_name, c.created_at
    FROM clients c LEFT JOIN users u ON u.id = c.assigned_sales_userId
    WHERE c.deleted_at IS NULL AND (${clientWhere.join(' OR ')})
    ORDER BY c.created_at DESC LIMIT 20`,
  ).bind(...clientParams).all<{
    id: string; name: string; phone: string | null; email: string | null; contract_status: string | null
    owner: string | null; owner_name: string | null; created_at: string
  }>()
  const matchedClients = clients.results.filter((c) =>
    clientIds.includes(c.id) || contactKey(phone ? c.phone ?? '' : c.email ?? '') === key)

  return [
    ...matchedClients.map((c): ContactMatch => ({
      type: 'client', id: c.id, leadNo: null, name: c.name, status: c.contract_status,
      ownerUserId: c.owner, ownerTeamId: null, ownerName: c.owner_name, createdAt: c.created_at,
    })),
    ...matchedLeads.filter((r) => !r.client_id).map((r): ContactMatch => ({
      type: 'lead', id: r.id, leadNo: r.lead_no, name: r.name, status: r.status,
      ownerUserId: r.owner, ownerTeamId: r.team, ownerName: r.owner_name, createdAt: r.created_at,
    })),
  ]
}

const leadLabel = (no: number | null) => (no != null ? `L-${String(no).padStart(4, '0')} ` : '')

/** 历史记录的文字说明（写进新线索的系统跟进记录和分配提醒） */
export function describeContactMatches(matches: ContactMatch[]): string {
  return matches.slice(0, 5).map((m) => {
    const owner = `负责人：${m.ownerName ?? '未分配'}`
    return m.type === 'client'
      ? `- 已是客户：${m.name}（${owner}）`
      : `- 线索 ${leadLabel(m.leadNo)}${m.name}（${owner}，状态：${m.status ?? '-'}，${m.createdAt.slice(0, 10)}）`
  }).join('\n')
}

/** 新建的外部线索如果联系方式以前出现过（超过 30 天的线索或已有客户），写一条系统跟进记录说明 */
export async function noteContactHistory(deps: Deps, actor: Actor, leadId: string, contact: string): Promise<void> {
  const matches = await findContactMatches(deps.db, contact, leadId)
  if (matches.length === 0) return
  await insertSystemActivityStatement(deps.db, { leadId }, actor.userId,
    `该联系方式之前来过：\n${describeContactMatches(matches)}`).run()
}

export interface VisibleContactMatch extends Omit<ContactMatch, 'ownerUserId' | 'ownerTeamId'> { canView: boolean }

/** 给界面用：相同联系方式的线索和客户，标出当前用户能否打开（看不到的只显示姓名与负责人） */
export async function listContactMatches(db: D1Database, actor: Actor, contact: string, excludeLeadId?: string): Promise<VisibleContactMatch[]> {
  const matches = await findContactMatches(db, contact, excludeLeadId)
  return matches.map(({ ownerUserId, ownerTeamId, ...m }) => ({
    ...m,
    canView: m.type === 'client'
      ? canViewClient(actor, { assigned_sales_userId: ownerUserId })
      : canViewLead(actor, { assigned_to_userId: ownerUserId, assigned_to_teamId: ownerTeamId }),
  }))
}
