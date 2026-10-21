import { recordOperation } from '../domain/operationLog'
import { leadLabel } from '../domain/leads/service'
interface Lead {
  id: string
  intended_services: string
  assigned_to_userId: string | null
  assigned_to_teamId: string | null
}

interface SalesUser {
  id: string
  team_id: string | null
  specialization: string
  current_leads_count: number
}

interface AssignmentRule {
  rule_type: 'round_robin' | 'load_balance' | 'skill_match' | 'region_match'
  priority: number
  config_json: string
}

export async function handleLeadAssignmentBatch(
  batch: MessageBatch<{ leadId: string }>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await assignLead(message.body.leadId, env)
      message.ack()
    } catch (err) {
      console.error(`分配线索 ${message.body.leadId} 失败:`, err)
      message.retry()
    }
  }
}

async function assignLead(leadId: string, env: Env): Promise<void> {
  const setting = await env.DB.prepare(
    "SELECT value FROM system_settings WHERE key = 'auto_assign_enabled'",
  ).first<{ value: string }>()
  if (setting?.value === 'false') return

  const lead = await env.DB.prepare(
    'SELECT id, intended_services, assigned_to_userId, assigned_to_teamId FROM leads WHERE id = ? AND assigned_to_userId IS NULL',
  ).bind(leadId).first<Lead>()
  if (!lead) return

  // 候选人范围：有团队 → 限定同团队；无团队 → 全局
  let candidateQuery: string
  let candidateParams: unknown[]

  if (lead.assigned_to_teamId) {
    candidateQuery = `
      SELECT id, team_id, specialization, current_leads_count
      FROM users
      WHERE role = 'sales' AND is_active = 1 AND team_id = ?
      ORDER BY current_leads_count ASC`
    candidateParams = [lead.assigned_to_teamId]
  } else {
    candidateQuery = `
      SELECT id, team_id, specialization, current_leads_count
      FROM users
      WHERE role = 'sales' AND is_active = 1
      ORDER BY current_leads_count ASC`
    candidateParams = []
  }

  const salesUsers = await env.DB.prepare(candidateQuery).bind(...candidateParams).all<SalesUser>()

  if (!salesUsers.results.length) {
    console.warn(`线索 ${leadId} 团队内无可用销售，暂不分配`)
    // 通知管理员团队内无人可分配
    await env.NOTIFICATION_QUEUE.send({
      type: 'lead_unassignable',
      leadId,
      teamId: lead.assigned_to_teamId,
    } as Parameters<typeof env.NOTIFICATION_QUEUE.send>[0])
    return
  }

  const rules = await env.DB.prepare(
    'SELECT rule_type, priority, config_json FROM assignment_rules WHERE is_active = 1 ORDER BY priority ASC',
  ).all<AssignmentRule>()

  let assignedUser: SalesUser | null = null
  for (const rule of rules.results) {
    const candidate = applyRule(rule, lead, salesUsers.results)
    if (candidate) { assignedUser = candidate; break }
  }
  // 兜底：当前线索数最少的
  assignedUser ??= salesUsers.results[0] ?? null
  if (!assignedUser) return

  // 只更新 assigned_to_userId，不覆盖团队归属
  await env.DB.prepare(
    `UPDATE leads SET assigned_to_userId = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).bind(assignedUser.id, leadId).run()

  await env.DB.prepare(
    'UPDATE users SET current_leads_count = current_leads_count + 1 WHERE id = ?',
  ).bind(assignedUser.id).run()

  const info = await env.DB.prepare('SELECT l.name, l.lead_no, u.name AS user_name FROM leads l LEFT JOIN users u ON u.id = ? WHERE l.id = ?')
    .bind(assignedUser.id, leadId).first<{ name: string; lead_no: number | null; user_name: string | null }>()
  await recordOperation(env.DB, null, {
    action: 'lead.assign', targetType: 'lead', targetId: leadId, targetLabel: info ? leadLabel(info.lead_no, info.name) : null,
    summary: `自动分配给 ${info?.user_name ?? assignedUser.id}`, changes: [{ field: 'assignedToUserId', from: null, to: info?.user_name ?? assignedUser.id }],
  })

  await env.NOTIFICATION_QUEUE.send({ type: 'lead_assigned', leadId, assignedToUserId: assignedUser.id })
}

function applyRule(rule: AssignmentRule, lead: Lead, users: SalesUser[]): SalesUser | null {
  switch (rule.rule_type) {
    case 'skill_match': {
      const matched = users.filter((u) => {
        const skills: string[] = JSON.parse(u.specialization || '[]')
        const leadServices: string[] = JSON.parse(lead.intended_services || '[]')
        return leadServices.some((s) => skills.includes(s))
      })
      return matched[0] ?? null // 已按 current_leads_count ASC 排序
    }
    case 'load_balance':
    case 'round_robin':
      return users[0] ?? null // 已按 current_leads_count ASC 排序
    default:
      return null
  }
}
