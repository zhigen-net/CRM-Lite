import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireAuth, requireAdmin } from '../middleware/auth'
import { toCamel } from '../../shared/db'
import { actorFromJwt } from '../../domain/actor'
import { restoreLead } from '../../domain/leads/service'

export const recycleBinRoutes = new Hono<{ Bindings: Env }>()

recycleBinRoutes.use('*', requireAuth, requireAdmin)

type EntityType = 'lead' | 'client' | 'service' | 'partner'

const ENTITY_CONFIG: Record<EntityType, { table: string; nameCol: string; extraCols?: string }> = {
  lead:    { table: 'leads',    nameCol: 'name', extraCols: 'contact_info, status, source' },
  client:  { table: 'clients',  nameCol: 'name', extraCols: 'phone, email' },
  service: { table: 'services', nameCol: 'name', extraCols: 'description, price' },
  partner: { table: 'partners', nameCol: 'name', extraCols: 'type, contact_person' },
}

// GET /api/admin/recycle-bin — 列出所有软删除的记录
recycleBinRoutes.get('/', async (c) => {
  const results: Array<Record<string, unknown> & { _type: EntityType }> = []

  for (const [type, cfg] of Object.entries(ENTITY_CONFIG) as [EntityType, typeof ENTITY_CONFIG[EntityType]][]) {
    const cols = ['id', 'name', 'deleted_at', 'created_at', ...(cfg.extraCols?.split(', ') ?? [])].join(', ')
    const rows = await c.env.DB.prepare(
      `SELECT ${cols} FROM ${cfg.table} WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
    ).all<Record<string, unknown>>()
    for (const row of rows.results) {
      results.push({ ...toCamel(row), _type: type })
    }
  }

  results.sort((a, b) => String(b.deletedAt ?? '').localeCompare(String(a.deletedAt ?? '')))
  return c.json({ data: results })
})

// POST /api/admin/recycle-bin/:type/:id/restore — 还原
recycleBinRoutes.post('/:type/:id/restore', async (c) => {
  const type = c.req.param('type') as EntityType
  const id = c.req.param('id')
  const cfg = ENTITY_CONFIG[type]
  if (!cfg) throw new HTTPException(400, { message: '无效的实体类型' })

  // 线索恢复需要同步负责人线索数，走业务服务层
  if (type === 'lead') {
    await restoreLead(c.env.DB, actorFromJwt(c.get('jwtPayload'), 'web'), id)
    return c.json({ data: { id, type, restored: true } })
  }

  const row = await c.env.DB.prepare(
    `SELECT id FROM ${cfg.table} WHERE id = ? AND deleted_at IS NOT NULL`,
  ).bind(id).first()
  if (!row) throw new HTTPException(404, { message: '记录不存在或未被删除' })

  await c.env.DB.prepare(`UPDATE ${cfg.table} SET deleted_at = NULL WHERE id = ?`).bind(id).run()
  return c.json({ data: { id, type, restored: true } })
})

// DELETE /api/admin/recycle-bin/:type/:id — 彻底删除
recycleBinRoutes.delete('/:type/:id', async (c) => {
  const type = c.req.param('type') as EntityType
  const id = c.req.param('id')
  const cfg = ENTITY_CONFIG[type]
  if (!cfg) throw new HTTPException(400, { message: '无效的实体类型' })

  const row = await c.env.DB.prepare(
    `SELECT id FROM ${cfg.table} WHERE id = ? AND deleted_at IS NOT NULL`,
  ).bind(id).first()
  if (!row) throw new HTTPException(404, { message: '记录不存在或未被删除' })

  if (type === 'lead') {
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM activity_attachments WHERE activity_id IN (SELECT id FROM sales_activities WHERE lead_id = ?)').bind(id),
      c.env.DB.prepare('DELETE FROM sales_activities WHERE lead_id = ?').bind(id),
      c.env.DB.prepare('DELETE FROM leads WHERE id = ?').bind(id),
    ])
  } else if (type === 'client') {
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM activity_attachments WHERE activity_id IN (SELECT id FROM sales_activities WHERE client_id = ?)').bind(id),
      c.env.DB.prepare('DELETE FROM sales_activities WHERE client_id = ?').bind(id),
      c.env.DB.prepare('DELETE FROM clients WHERE id = ?').bind(id),
    ])
  } else {
    await c.env.DB.prepare(`DELETE FROM ${cfg.table} WHERE id = ?`).bind(id).run()
  }

  return c.json({ data: { id, type, deleted: true } })
})
