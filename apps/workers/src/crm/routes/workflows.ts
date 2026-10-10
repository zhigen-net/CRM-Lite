import { Hono } from 'hono'
import { v4 as uuidv4 } from 'uuid'
import { requireAuth, requireAdmin } from '../middleware/auth'
import { toCamel } from '../../shared/db'

function parseWorkflow(row: Record<string, unknown>) {
  const w = toCamel(row) as Record<string, unknown>
  for (const key of ['trigger', 'conditions', 'actions'] as const) {
    if (typeof w[key] === 'string') {
      try { w[key] = JSON.parse(w[key] as string) } catch { /* keep */ }
    }
  }
  // 兼容迁移时 json_group_array 双重序列化的情况
  if (Array.isArray(w.actions)) {
    w.actions = (w.actions as unknown[]).map((a) =>
      typeof a === 'string' ? JSON.parse(a) : a,
    )
  }
  return w
}

export type WorkflowTrigger =
  | { type: 'field_change'; field: string; to: string }
  | { type: 'on_create' }

export type WorkflowAction =
  | { type: 'require_activity'; contentRequired: boolean; contentPresets?: string[] }
  | { type: 'require_fields';   fields: Array<{ field: string; label: string; type: string; optionGroup?: string }> }
  | { type: 'set_field';        field: string; label: string; value: string }
  | { type: 'send_email';       to: string; subject: string; body: string }
  | { type: 'webhook';          url: string; method: string; body: string }

export interface Workflow {
  id: string
  name: string
  entityType: string
  trigger: WorkflowTrigger
  conditions: unknown[]
  actions: WorkflowAction[]
  isActive: number
  createdAt: string
  updatedAt: string
}

// ── 普通用户接口：/api/workflows（需登录，无需管理员）────────────────────────
export const workflowsRoutes = new Hono<{ Bindings: Env }>()

workflowsRoutes.use('*', requireAuth)

workflowsRoutes.get('/', async (c) => {
  const entityType = c.req.query('entityType')
  const sql = entityType
    ? 'SELECT * FROM workflows WHERE is_active = 1 AND entity_type = ? ORDER BY created_at'
    : 'SELECT * FROM workflows WHERE is_active = 1 ORDER BY entity_type, created_at'
  const rows = await c.env.DB.prepare(sql)
    .bind(...(entityType ? [entityType] : []))
    .all<Record<string, unknown>>()
  return c.json({ data: rows.results.map(parseWorkflow) })
})

// ── Admin 接口：/api/admin/workflows ─────────────────────────────────────────
export const workflowsAdminRoutes = new Hono<{ Bindings: Env }>()
workflowsAdminRoutes.use('*', requireAuth, requireAdmin)

// 查询全部（含禁用）
workflowsAdminRoutes.get('/', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT * FROM workflows ORDER BY entity_type, created_at',
  ).all<Record<string, unknown>>()
  return c.json({ data: rows.results.map(parseWorkflow) })
})

// 查询单个
workflowsAdminRoutes.get('/:id', async (c) => {
  const { id } = c.req.param()
  const row = await c.env.DB.prepare('SELECT * FROM workflows WHERE id = ?').bind(id).first<Record<string, unknown>>()
  if (!row) return c.json({ message: '工作流不存在' }, 404)
  return c.json({ data: parseWorkflow(row) })
})

// 新建
workflowsAdminRoutes.post('/', async (c) => {
  const body = await c.req.json<{
    name: string
    entityType: string
    trigger: WorkflowTrigger
    conditions?: unknown[]
    actions: WorkflowAction[]
  }>()
  const id = uuidv4()
  await c.env.DB.prepare(
    `INSERT INTO workflows (id, name, entity_type, trigger, conditions, actions)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    body.name,
    body.entityType,
    JSON.stringify(body.trigger),
    JSON.stringify(body.conditions ?? []),
    JSON.stringify(body.actions),
  ).run()
  return c.json({ data: { id } }, 201)
})

// 修改
workflowsAdminRoutes.put('/:id', async (c) => {
  const { id } = c.req.param()
  const body = await c.req.json<Partial<{
    name: string
    entityType: string
    trigger: WorkflowTrigger
    conditions: unknown[]
    actions: WorkflowAction[]
    isActive: boolean
  }>>()
  const updates: string[] = ['updated_at = CURRENT_TIMESTAMP']
  const params: unknown[] = []
  if (body.name       !== undefined) { updates.push('name = ?');        params.push(body.name) }
  if (body.entityType !== undefined) { updates.push('entity_type = ?'); params.push(body.entityType) }
  if (body.trigger    !== undefined) { updates.push('trigger = ?');     params.push(JSON.stringify(body.trigger)) }
  if (body.conditions !== undefined) { updates.push('conditions = ?');  params.push(JSON.stringify(body.conditions)) }
  if (body.actions    !== undefined) { updates.push('actions = ?');     params.push(JSON.stringify(body.actions)) }
  if (body.isActive   !== undefined) { updates.push('is_active = ?');   params.push(body.isActive ? 1 : 0) }
  if (params.length === 0) return c.json({ message: '无可更新字段' }, 400)
  params.push(id)
  await c.env.DB.prepare(
    `UPDATE workflows SET ${updates.join(', ')} WHERE id = ?`,
  ).bind(...params).run()
  return c.json({ data: { id } })
})

// 删除
workflowsAdminRoutes.delete('/:id', async (c) => {
  const { id } = c.req.param()
  await c.env.DB.prepare('DELETE FROM workflows WHERE id = ?').bind(id).run()
  return c.json({ data: { id } })
})
