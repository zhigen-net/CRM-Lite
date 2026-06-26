import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { HTTPException } from 'hono/http-exception'
import { v4 as uuidv4 } from 'uuid'
import { requireAuth } from '../middleware/auth'
import { toCamel, toCamelList } from '../../shared/db'
import { callAiModel, extractJson } from '../../shared/ai'

export const aiAnalysisRoutes = new Hono<{ Bindings: Env }>()

aiAnalysisRoutes.use('*', requireAuth)

// ─── 提示词 CRUD（admin only） ────────────────────────────────────────────────

aiAnalysisRoutes.get('/admin/ai/prompts', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, key, name, system_prompt, user_prompt_template, model_id, is_active, updated_at FROM ai_prompts ORDER BY key ASC',
  ).all()
  return c.json({ data: toCamelList(rows.results as Record<string, unknown>[]) })
})

aiAnalysisRoutes.put(
  '/admin/ai/prompts/:id',
  zValidator('json', z.object({
    name:                 z.string().min(1).optional(),
    systemPrompt:         z.string().optional(),
    userPromptTemplate:   z.string().optional(),
    modelId:              z.string().nullable().optional(),
    isActive:             z.number().int().min(0).max(1).optional(),
  })),
  async (c) => {
    const { role } = c.get('jwtPayload')
    if (role !== 'admin') throw new HTTPException(403, { message: '仅管理员可操作' })
    const id = c.req.param('id')
    const body = c.req.valid('json')

    const existing = await c.env.DB.prepare('SELECT id FROM ai_prompts WHERE id = ?').bind(id).first()
    if (!existing) throw new HTTPException(404, { message: '提示词不存在' })

    const updates: string[] = ['updated_at = CURRENT_TIMESTAMP']
    const params: unknown[] = []
    if (body.name               !== undefined) { updates.push('name = ?');                  params.push(body.name) }
    if (body.systemPrompt       !== undefined) { updates.push('system_prompt = ?');          params.push(body.systemPrompt) }
    if (body.userPromptTemplate !== undefined) { updates.push('user_prompt_template = ?');   params.push(body.userPromptTemplate) }
    if (body.modelId            !== undefined) { updates.push('model_id = ?');               params.push(body.modelId) }
    if (body.isActive           !== undefined) { updates.push('is_active = ?');              params.push(body.isActive) }

    params.push(id)
    await c.env.DB.prepare(`UPDATE ai_prompts SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...params).run()
    return c.json({ data: { success: true } })
  },
)

// ─── 分析执行辅助 ─────────────────────────────────────────────────────────────

async function runAnalysis(
  env: Env,
  entityType: 'lead' | 'client',
  entityId: string,
  userId: string | null,
  triggeredBy: 'manual' | 'workflow',
): Promise<Record<string, unknown>> {
  const promptKey = entityType === 'lead' ? 'lead_analysis' : 'client_analysis'

  // 加载提示词
  const promptRow = await env.DB.prepare(
    'SELECT system_prompt, user_prompt_template, model_id FROM ai_prompts WHERE key = ? AND is_active = 1',
  ).bind(promptKey).first<{ system_prompt: string; user_prompt_template: string; model_id: string | null }>()
  if (!promptRow) throw new HTTPException(400, { message: `提示词 ${promptKey} 未配置或已禁用` })

  // 加载实体数据
  let entityData: Record<string, string> = {}
  if (entityType === 'lead') {
    const row = await env.DB.prepare(`
      SELECT l.name, l.source, l.status, l.intended_services, l.next_contact_date, l.contact_info,
             u.name as assigned_to_name
      FROM leads l LEFT JOIN users u ON l.assigned_to_userId = u.id
      WHERE l.id = ?
    `).bind(entityId).first<Record<string, unknown>>()
    if (!row) throw new HTTPException(404, { message: '线索不存在' })
    const parsed = toCamel(row) as Record<string, unknown>
    try {
      const services = JSON.parse(parsed.intendedServices as string ?? '[]')
      parsed.intendedServices = Array.isArray(services) ? services.join('、') : parsed.intendedServices
    } catch { /* keep as-is */ }
    for (const [k, v] of Object.entries(parsed)) entityData[k] = v == null ? '' : String(v)
  } else {
    const row = await env.DB.prepare(`
      SELECT c.name, c.contract_status, c.service_plans, c.next_contact_date,
             u.name as assigned_sales_name
      FROM clients c LEFT JOIN users u ON c.assigned_sales_userId = u.id
      WHERE c.id = ?
    `).bind(entityId).first<Record<string, unknown>>()
    if (!row) throw new HTTPException(404, { message: '客户不存在' })
    const parsed = toCamel(row) as Record<string, unknown>
    try {
      const plans = JSON.parse(parsed.servicePlans as string ?? '[]')
      parsed.servicePlans = Array.isArray(plans) ? plans.join('、') : parsed.servicePlans
    } catch { /* keep as-is */ }
    for (const [k, v] of Object.entries(parsed)) entityData[k] = v == null ? '' : String(v)
  }

  // 加载最近 20 条跟进记录
  const actRows = await env.DB.prepare(`
    SELECT sa.activity_type, sa.description, sa.activity_date, sa.next_contact_date,
           u.name as recorder_name
    FROM sales_activities sa LEFT JOIN users u ON sa.user_id = u.id
    WHERE ${entityType === 'lead' ? 'sa.lead_id' : 'sa.client_id'} = ?
    ORDER BY sa.activity_date DESC, sa.created_at DESC
    LIMIT 20
  `).bind(entityId).all<Record<string, unknown>>()

  const activitiesText = actRows.results.length === 0
    ? '（暂无跟进记录）'
    : actRows.results.map((r) => {
        const parts = [`[${r.activity_date}] ${r.activity_type}`]
        if (r.recorder_name) parts.push(`by ${r.recorder_name}`)
        if (r.description) parts.push(`：${String(r.description).slice(0, 200)}`)
        if (r.next_contact_date) parts.push(`→ 下次联系 ${r.next_contact_date}`)
        return parts.join(' ')
      }).join('\n')

  // 加载可用跟进类型
  const typeRows = await env.DB.prepare(
    "SELECT label FROM option_items WHERE group_key = 'activity_type' AND is_active = 1 ORDER BY sort_order ASC",
  ).all<{ label: string }>()
  const activityTypes = typeRows.results.map((r) => r.label).join('、') || '（未配置）'

  // 加载系统时区
  const tzRow = await env.DB.prepare("SELECT value FROM system_settings WHERE key = 'timezone'")
    .first<{ value: string }>()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: tzRow?.value ?? 'Asia/Shanghai' })

  // 填充模板变量
  const vars: Record<string, string> = {
    today,
    activities: activitiesText,
    activity_types: activityTypes,
    ...entityData,
  }
  const userPrompt = promptRow.user_prompt_template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '')

  // 调用 AI
  const { content, modelDisplayName } = await callAiModel(env, promptRow.model_id, promptRow.system_prompt, userPrompt)

  // 解析 JSON
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(extractJson(content))
  } catch {
    parsed = { summary: '分析完成', analysis: content, actions: [] }
  }

  const analysisId = uuidv4()
  await env.DB.prepare(`
    INSERT INTO ai_analyses (id, entity_type, entity_id, prompt_key, model_display_name, summary, analysis, actions_json, triggered_by, created_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    analysisId, entityType, entityId, promptKey, modelDisplayName,
    String(parsed.summary ?? ''),
    String(parsed.analysis ?? ''),
    JSON.stringify(Array.isArray(parsed.actions) ? parsed.actions : []),
    triggeredBy,
    userId,
  ).run()

  return {
    id: analysisId,
    summary: parsed.summary,
    analysis: parsed.analysis,
    actions: Array.isArray(parsed.actions) ? parsed.actions : [],
    modelDisplayName,
    executedActionsJson: '[]',
    createdAt: new Date().toISOString(),
  }
}

// 导出供工作流使用
export { runAnalysis }

// ─── GET /api/leads/:id/ai-analyses/latest ───────────────────────────────────

aiAnalysisRoutes.get('/leads/:id/ai-analyses/latest', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB.prepare(`
    SELECT id, summary, analysis, actions_json, executed_actions_json, model_display_name, created_at
    FROM ai_analyses WHERE entity_type = 'lead' AND entity_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).bind(id).first<Record<string, unknown>>()
  return c.json({ data: row ? toCamel(row) : null })
})

// ─── POST /api/leads/:id/ai-analyses ─────────────────────────────────────────

aiAnalysisRoutes.post('/leads/:id/ai-analyses', async (c) => {
  const { userId } = c.get('jwtPayload')
  const id = c.req.param('id')
  try {
    const result = await runAnalysis(c.env, 'lead', id, userId, 'manual')
    return c.json({ data: result }, 201)
  } catch (e) {
    if (e instanceof HTTPException) throw e
    throw new HTTPException(500, { message: e instanceof Error ? e.message : 'AI 分析失败' })
  }
})

// ─── GET /api/clients/:id/ai-analyses/latest ─────────────────────────────────

aiAnalysisRoutes.get('/clients/:id/ai-analyses/latest', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB.prepare(`
    SELECT id, summary, analysis, actions_json, executed_actions_json, model_display_name, created_at
    FROM ai_analyses WHERE entity_type = 'client' AND entity_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).bind(id).first<Record<string, unknown>>()
  return c.json({ data: row ? toCamel(row) : null })
})

// ─── POST /api/clients/:id/ai-analyses ───────────────────────────────────────

aiAnalysisRoutes.post('/clients/:id/ai-analyses', async (c) => {
  const { userId } = c.get('jwtPayload')
  const id = c.req.param('id')
  try {
    const result = await runAnalysis(c.env, 'client', id, userId, 'manual')
    return c.json({ data: result }, 201)
  } catch (e) {
    if (e instanceof HTTPException) throw e
    throw new HTTPException(500, { message: e instanceof Error ? e.message : 'AI 分析失败' })
  }
})

// ─── PATCH /api/ai-analyses/:id/execute-action ───────────────────────────────
// 标记某个 action 已执行

aiAnalysisRoutes.patch(
  '/ai-analyses/:id/execute-action',
  zValidator('json', z.object({ actionType: z.string() })),
  async (c) => {
    const id = c.req.param('id')
    const { actionType } = c.req.valid('json')

    const row = await c.env.DB.prepare('SELECT executed_actions_json FROM ai_analyses WHERE id = ?')
      .bind(id).first<{ executed_actions_json: string }>()
    if (!row) throw new HTTPException(404, { message: '分析记录不存在' })

    let executed: string[] = []
    try { executed = JSON.parse(row.executed_actions_json ?? '[]') } catch { /* */ }
    if (!executed.includes(actionType)) executed.push(actionType)

    await c.env.DB.prepare('UPDATE ai_analyses SET executed_actions_json = ? WHERE id = ?')
      .bind(JSON.stringify(executed), id).run()

    return c.json({ data: { success: true } })
  },
)
