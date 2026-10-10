import { toCamel } from '../../shared/db'
import { sendEmail } from '../../shared/email'
import { runAnalysis } from '../routes/aiAnalysis'

// ── 类型 ──────────────────────────────────────────────────────────────────────

// 定时触发的匹配条件
type ScheduledCondition =
  | 'date_is_today'      // 日期字段 = 今天
  | 'date_overdue'       // 日期字段 < 今天（已过期）
  | 'no_activity_days'   // 最近 N 天内无跟进记录


type WfTrigger =
  | { type: 'field_change'; field: string; to: string }   // to='*' 表示任意值
  | { type: 'on_create' }
  | { type: 'scheduled'; condition: ScheduledCondition; field?: string; days?: number }

type WfAction =
  | { type: 'require_activity'; contentRequired: boolean; contentPresets?: string[] }
  | { type: 'require_fields'; fields: unknown[] }
  | { type: 'set_field'; field: string; label: string; value: string }
  | { type: 'send_email'; to: string; subject: string; body: string }
  | { type: 'webhook'; url: string; method: string; body: string }
  | { type: 'ai_analysis'; autoExecute?: string[] }

interface StoredWorkflow {
  id: string
  entity_type: string
  trigger: string
  actions: string
  is_active: number
}

// ── 字段名映射（camelCase → DB 列名）──────────────────────────────────────────

const FIELD_TO_COLUMN: Record<string, Record<string, string>> = {
  lead: {
    status:           'status',
    lostReason:       'lost_reason',
    source:           'source',
    assignedToUserId: 'assigned_to_userId',
    assignedToTeamId: 'assigned_to_teamId',
    intendedServices: 'intended_services',
    nextContactDate:  'next_contact_date',
    notes:            'notes',
    contactInfo:      'contact_info',
  },
  client: {
    contractStatus:      'contract_status',
    assignedSalesUserId: 'assigned_sales_userId',
    name:  'name',
    email: 'email',
    phone: 'phone',
  },
}

// ── 时间变量（基于系统时区）─────────────────────────────────────────────────

function buildTimeVars(timezone: string): Record<string, string> {
  const tz = timezone || 'Asia/Shanghai'

  // 以目标时区的"今天零点"为基准
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: tz }) // YYYY-MM-DD
  const today = new Date(`${todayStr}T00:00:00`)

  const add = (base: Date, days: number) => {
    const d = new Date(base)
    d.setDate(d.getDate() + days)
    return d.toLocaleDateString('en-CA', { timeZone: tz })
  }

  // 本周一
  const dow = today.getDay() === 0 ? 6 : today.getDay() - 1
  const weekStartStr = add(today, -dow)
  const weekEndStr   = add(today, 6 - dow)

  // 本月首尾
  const [year, month] = todayStr.split('-').map(Number) as [number, number]
  const monthStartStr = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(year, month, 0).getDate()
  const monthEndStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  // 当前时间（精确到分钟）
  const nowStr = new Date().toLocaleString('zh-CN', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).replace(/\//g, '-')

  return {
    now:        nowStr,
    today:      todayStr,
    tomorrow:   add(today, 1),
    yesterday:  add(today, -1),
    weekStart:  weekStartStr,
    weekEnd:    weekEndStr,
    monthStart: monthStartStr,
    monthEnd:   monthEndStr,
  }
}

// ── 构建完整模板上下文 ────────────────────────────────────────────────────────

function buildContext(
  entityData: Record<string, unknown>,
  timeVars: Record<string, string>,
): Record<string, string> {
  const ctx: Record<string, string> = {}

  // 实体字段（camelCase，数组转中文顿号分隔）
  for (const [k, v] of Object.entries(entityData)) {
    if (Array.isArray(v)) ctx[k] = (v as unknown[]).join('、')
    else if (v != null)   ctx[k] = String(v)
  }

  // 时间变量（优先级低于同名实体字段）
  for (const [k, v] of Object.entries(timeVars)) {
    if (!(k in ctx)) ctx[k] = v
  }

  return ctx
}

// ── 模板插值：{{field}} 或 {{entity.field}} ──────────────────────────────────
// 未知变量保留原样（不替换为空），方便调试

function interpolate(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (match, key: string) => {
    // 支持 {{lead.name}} → 取末段 'name'
    const field = key.includes('.') ? (key.split('.').pop() ?? key) : key
    return field in ctx ? ctx[field]! : match
  })
}

// ── 解析 stored workflow，防御 double-JSON ────────────────────────────────────

function parseWorkflow(row: StoredWorkflow): { trigger: WfTrigger; actions: WfAction[] } {
  let trigger: WfTrigger
  try { trigger = typeof row.trigger === 'string' ? JSON.parse(row.trigger) : row.trigger }
  catch { trigger = { type: 'on_create' } }

  let actions: WfAction[] = []
  try {
    const raw = typeof row.actions === 'string' ? JSON.parse(row.actions) : row.actions
    actions = (Array.isArray(raw) ? raw : []).map((a: unknown) =>
      typeof a === 'string' ? JSON.parse(a) : a,
    ) as WfAction[]
  } catch { /* ignore */ }

  return { trigger, actions }
}

// ── 触发条件匹配 ──────────────────────────────────────────────────────────────

function matchesTrigger(
  wfTrigger: WfTrigger,
  event: { type: 'on_create' } | { type: 'field_change'; field: string; to: string },
): boolean {
  if (wfTrigger.type !== event.type) return false
  if (event.type === 'field_change' && wfTrigger.type === 'field_change') {
    if (wfTrigger.field !== event.field) return false
    return wfTrigger.to === '*' || wfTrigger.to === event.to
  }
  return true
}

// ── 主入口 ────────────────────────────────────────────────────────────────────

export async function executeWorkflowsForTrigger(
  db: D1Database,
  env: Env,
  entityType: 'lead' | 'client' | 'activity',
  entityId: string,
  event: { type: 'on_create' } | { type: 'field_change'; field: string; to: string },
): Promise<void> {
  // 1. 查询该实体类型的所有启用工作流
  const rows = await db.prepare(
    'SELECT id, entity_type, trigger, actions, is_active FROM workflows WHERE entity_type = ? AND is_active = 1',
  ).bind(entityType).all<StoredWorkflow>()

  const matched = rows.results.filter((row) => {
    const { trigger } = parseWorkflow(row)
    return matchesTrigger(trigger, event)
  })
  if (!matched.length) return

  // 2. 读取实体数据（联表获取负责人姓名等）
  let entityData: Record<string, unknown> = {}
  if (entityType === 'lead') {
    const raw = await db.prepare(
      `SELECT l.*, u.name as assigned_to_name, u.email as assigned_to_email
       FROM leads l
       LEFT JOIN users u ON l.assigned_to_userId = u.id
       WHERE l.id = ?`,
    ).bind(entityId).first<Record<string, unknown>>()
    entityData = raw ? (toCamel(raw) as Record<string, unknown>) : {}
  } else if (entityType === 'client') {
    const raw = await db.prepare(
      `SELECT c.*, u.name as assigned_sales_name, u.email as assigned_sales_email
       FROM clients c
       LEFT JOIN users u ON c.assigned_sales_userId = u.id
       WHERE c.id = ?`,
    ).bind(entityId).first<Record<string, unknown>>()
    entityData = raw ? (toCamel(raw) as Record<string, unknown>) : {}
  } else {
    // activity：联表获取记录人、关联线索/客户名
    const raw = await db.prepare(
      `SELECT sa.*,
              u.name as recorder_name, u.email as recorder_email,
              l.name as lead_name, c.name as client_name
       FROM sales_activities sa
       LEFT JOIN users u ON sa.user_id = u.id
       LEFT JOIN leads l ON sa.lead_id = l.id
       LEFT JOIN clients c ON sa.client_id = c.id
       WHERE sa.id = ?`,
    ).bind(entityId).first<Record<string, unknown>>()
    entityData = raw ? (toCamel(raw) as Record<string, unknown>) : {}
  }

  // 3. 读取系统时区
  const tzRow = await db.prepare(
    "SELECT value FROM system_settings WHERE key = 'timezone'",
  ).first<{ value: string }>()
  const timezone = tzRow?.value ?? 'Asia/Shanghai'

  // 4. 构建模板上下文（实体数据 + 时间变量）
  const ctx = buildContext(entityData, buildTimeVars(timezone))

  const fieldMap = FIELD_TO_COLUMN[entityType] ?? {}
  const table    = entityType === 'lead' ? 'leads' : 'clients'

  // 5. 依次执行各工作流的动作
  for (const row of matched) {
    const { actions } = parseWorkflow(row)
    for (const action of actions) {
      try {
        if (action.type === 'set_field') {
          const col = fieldMap[action.field]
          if (!col) continue
          const value = interpolate(action.value, ctx)
          await db.prepare(`UPDATE ${table} SET ${col} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .bind(value, entityId).run()
          // 同步更新内存副本，后续动作插值可读到最新值
          ctx[action.field] = value

        } else if (action.type === 'webhook') {
          const url  = interpolate(action.url,  ctx)
          const body = interpolate(action.body, ctx)
          await fetch(url, {
            method: action.method ?? 'POST',
            headers: { 'Content-Type': 'application/json' },
            ...(action.method !== 'GET' ? { body } : {}),
          })

        } else if (action.type === 'send_email') {
          await sendEmail(
            env,
            interpolate(action.to,      ctx),
            interpolate(action.subject,  ctx),
            interpolate(action.body,     ctx),
          )
        } else if (action.type === 'ai_analysis' && (entityType === 'lead' || entityType === 'client')) {
          const result = await runAnalysis(env, entityType, entityId, null, 'workflow')
          // 自动执行指定类型的建议操作
          if (action.autoExecute?.length && Array.isArray(result.actions)) {
            for (const act of result.actions as { type: string; value: string }[]) {
              if (!action.autoExecute.includes(act.type)) continue
              const table = entityType === 'lead' ? 'leads' : 'clients'
              const fieldMap = FIELD_TO_COLUMN[entityType] ?? {}
              if (act.type === 'set_next_contact_date') {
                const col = fieldMap['nextContactDate'] ?? 'next_contact_date'
                await db.prepare(`UPDATE ${table} SET ${col} = ? WHERE id = ?`).bind(act.value, entityId).run()
              } else if (act.type === 'update_lead_status' && entityType === 'lead') {
                await db.prepare('UPDATE leads SET status = ? WHERE id = ?').bind(act.value, entityId).run()
              } else if (act.type === 'update_contract_status' && entityType === 'client') {
                await db.prepare('UPDATE clients SET contract_status = ? WHERE id = ?').bind(act.value, entityId).run()
              }
            }
          }
        }
        // require_activity / require_fields 仅前端约束，后端跳过
      } catch (err) {
        console.error(`[workflow] action ${action.type} failed in workflow ${row.id}:`, err)
      }
    }
  }
}

// ── 定时工作流（Cron 每日执行）────────────────────────────────────────────────

// 每次定时运行的处理上限，避免超出 Workers 单次调用的限制
// （免费版：10ms CPU、50 个外部请求）。未处理完的记录不会被记为已执行，下次运行继续处理。
const MAX_ENTITIES_PER_RUN = 100
const MAX_EXTERNAL_CALLS_PER_RUN = 40   // 邮件 + webhook

export async function executeScheduledWorkflows(db: D1Database, env: Env): Promise<void> {
  // 读取系统时区
  const tzRow = await db.prepare("SELECT value FROM system_settings WHERE key = 'timezone'")
    .first<{ value: string }>()
  const timezone = tzRow?.value ?? 'Asia/Shanghai'
  const today = new Date().toLocaleDateString('en-CA', { timeZone: timezone }) // YYYY-MM-DD
  const timeVars = buildTimeVars(timezone)

  // 查询所有启用的 scheduled 工作流
  const { results: scheduledRows } = await db.prepare(
    "SELECT id, entity_type, trigger, actions, is_active FROM workflows WHERE is_active = 1",
  ).all<StoredWorkflow>()

  const scheduledWorkflows = scheduledRows
    .map((row) => ({ row, ...parseWorkflow(row) }))
    .filter(({ trigger }) => trigger.type === 'scheduled')

  if (!scheduledWorkflows.length) return

  let entitiesLeft = MAX_ENTITIES_PER_RUN
  let externalCallsLeft = MAX_EXTERNAL_CALLS_PER_RUN

  for (const { row, trigger, actions } of scheduledWorkflows) {
    if (trigger.type !== 'scheduled') continue
    if (entitiesLeft <= 0 || externalCallsLeft <= 0) {
      console.warn(`[workflow/scheduled] 已达本次运行上限，工作流 ${row.id} 留待下次运行`)
      break
    }
    const { condition, field, days } = trigger
    const entityType = row.entity_type as 'lead' | 'client'
    const table  = entityType === 'lead' ? 'leads' : 'clients'
    const fieldMap = FIELD_TO_COLUMN[entityType] ?? {}
    const externalCallsPerEntity = actions.filter((a) => a.type === 'webhook' || a.type === 'send_email').length

    // 每个匹配结果带上 trigger_key；已在 workflow_scheduled_runs 中记录过的组合直接排除
    const notYetRun = (keyExpr: string) => `NOT EXISTS (
      SELECT 1 FROM workflow_scheduled_runs r
      WHERE r.workflow_id = ? AND r.entity_id = e.id AND r.trigger_key = ${keyExpr}
    )`

    try {
      let matched: { id: string; trigger_key: string }[] = []

      if (condition === 'date_is_today' && field) {
        const col = fieldMap[field]
        if (!col) continue
        const { results } = await db.prepare(
          `SELECT e.id, ? AS trigger_key FROM ${table} e
           WHERE e.deleted_at IS NULL AND DATE(e.${col}) = ? AND ${notYetRun('?')}
           LIMIT ?`,
        ).bind(today, today, row.id, today, entitiesLeft).all<{ id: string; trigger_key: string }>()
        matched = results

      } else if (condition === 'date_overdue' && field) {
        const col = fieldMap[field]
        if (!col) continue
        const { results } = await db.prepare(
          `SELECT e.id, CAST(e.${col} AS TEXT) AS trigger_key FROM ${table} e
           WHERE e.deleted_at IS NULL AND e.${col} IS NOT NULL AND DATE(e.${col}) < ?
             AND ${notYetRun(`CAST(e.${col} AS TEXT)`)}
           LIMIT ?`,
        ).bind(today, row.id, entitiesLeft).all<{ id: string; trigger_key: string }>()
        matched = results

      } else if (condition === 'no_activity_days' && days != null && Number(days) > 0) {
        // 找出最近 N 天内没有跟进记录的实体；trigger_key = 最近一次跟进日期（无跟进为 'none'）
        const col = entityType === 'lead' ? 'lead_id' : 'client_id'
        const { results } = await db.prepare(
          `SELECT e.id, e.trigger_key FROM (
             SELECT x.id, COALESCE((
               SELECT MAX(a.activity_date) FROM sales_activities a
               WHERE a.${col} = x.id AND a.activity_type != 'System'
             ), 'none') AS trigger_key
             FROM ${table} x WHERE x.deleted_at IS NULL
           ) e
           WHERE (e.trigger_key = 'none' OR e.trigger_key < DATE(?, ?))
             AND ${notYetRun('e.trigger_key')}
           LIMIT ?`,
        ).bind(today, `-${Math.floor(Number(days))} days`, row.id, entitiesLeft).all<{ id: string; trigger_key: string }>()
        matched = results
      }

      // 对每个匹配实体执行动作
      for (const { id: entityId, trigger_key: triggerKey } of matched) {
        if (entitiesLeft <= 0 || externalCallsLeft < externalCallsPerEntity) {
          console.warn(`[workflow/scheduled] 已达本次运行上限，工作流 ${row.id} 剩余记录留待下次运行`)
          break
        }
        entitiesLeft--
        externalCallsLeft -= externalCallsPerEntity

        try {
          let entityData: Record<string, unknown> = {}
          if (entityType === 'lead') {
            const raw = await db.prepare(
              `SELECT l.*, u.name as assigned_to_name, u.email as assigned_to_email
               FROM leads l LEFT JOIN users u ON l.assigned_to_userId = u.id WHERE l.id = ?`,
            ).bind(entityId).first<Record<string, unknown>>()
            entityData = raw ? (toCamel(raw) as Record<string, unknown>) : {}
          } else {
            const raw = await db.prepare(
              `SELECT c.*, u.name as assigned_sales_name, u.email as assigned_sales_email
               FROM clients c LEFT JOIN users u ON c.assigned_sales_userId = u.id WHERE c.id = ?`,
            ).bind(entityId).first<Record<string, unknown>>()
            entityData = raw ? (toCamel(raw) as Record<string, unknown>) : {}
          }

          const ctx = buildContext(entityData, timeVars)

          for (const action of actions) {
            try {
              if (action.type === 'set_field') {
                const col = fieldMap[action.field]
                if (!col) continue
                const value = interpolate(action.value, ctx)
                await db.prepare(`UPDATE ${table} SET ${col} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
                  .bind(value, entityId).run()
                ctx[action.field] = value
              } else if (action.type === 'webhook') {
                const url  = interpolate(action.url,  ctx)
                const body = interpolate(action.body, ctx)
                await fetch(url, {
                  method: action.method ?? 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  ...(action.method !== 'GET' ? { body } : {}),
                })
              } else if (action.type === 'send_email') {
                await sendEmail(
                  env,
                  interpolate(action.to,      ctx),
                  interpolate(action.subject,  ctx),
                  interpolate(action.body,     ctx),
                )
              }
            } catch (err) {
              console.error(`[workflow/scheduled] action ${action.type} failed for ${entityId}:`, err)
            }
          }

          // 记为已执行（单个动作失败也记录，避免每天重复发送其它成功的动作）
          await db.prepare(
            'INSERT OR IGNORE INTO workflow_scheduled_runs (workflow_id, entity_id, trigger_key) VALUES (?, ?, ?)',
          ).bind(row.id, entityId, triggerKey).run()
        } catch (err) {
          console.error(`[workflow/scheduled] entity ${entityId} failed:`, err)
        }
      }
    } catch (err) {
      console.error(`[workflow/scheduled] workflow ${row.id} failed:`, err)
    }
  }
}
