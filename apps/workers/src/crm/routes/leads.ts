import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth, requireAdmin } from '../middleware/auth'
import { actorFromJwt, depsFrom } from '../../domain/actor'
import * as leads from '../../domain/leads/service'
import { getLeadAttribution } from '../../domain/tracking/attribution'

// 线索接口：只做参数解析与响应格式，业务规则在 domain/leads
export const leadsRoutes = new Hono<{ Bindings: Env }>()

leadsRoutes.use('*', requireAuth)


// GET /api/leads/sources — 返回去重的来源列表（用于前端自动补全）
leadsRoutes.get('/sources', async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT DISTINCT source FROM leads WHERE source IS NOT NULL AND source != '' AND deleted_at IS NULL ORDER BY source ASC",
  ).all<{ source: string }>()
  return c.json({ data: rows.results.map((r) => r.source) })
})

// GET /api/leads/new-count — 导航栏"新线索"角标专用的轻量计数（前端定时轮询）
leadsRoutes.get('/new-count', async (c) => {
  const total = await leads.countNewLeads(c.env.DB, actorFromJwt(c.get('jwtPayload'), 'web'))
  return c.json({ total })
})

// GET /api/leads
leadsRoutes.get('/', async (c) => {
  const q = c.req.query()
  const result = await leads.listLeads(c.env.DB, actorFromJwt(c.get('jwtPayload'), 'web'), {
    status: q.status, mine: q.mine === 'true', search: q.search, source: q.source, assignedTo: q.assignedTo,
    nextContact: q.nextContact, createdAt: q.createdAt, activityCount: q.activityCount, service: q.service,
    page: Number(q.page ?? '1'), pageSize: Number(q.pageSize ?? '20'),
  })
  return c.json(result)
})

// GET /api/leads/:id
leadsRoutes.get('/:id', async (c) => {
  const lead = await leads.getLead(c.env.DB, actorFromJwt(c.get('jwtPayload'), 'web'), c.req.param('id'))
  return c.json({ data: lead })
})

// GET /api/leads/:id/attribution（来源与访问轨迹；没有关联访客时 data 为 null）
leadsRoutes.get('/:id/attribution', async (c) =>
  c.json({ data: await getLeadAttribution(c.env.DB, actorFromJwt(c.get('jwtPayload'), 'web'), c.req.param('id')) }))

const leadSchema = z.object({
  source: z.string().min(1),
  name: z.string().min(1),
  contactInfo: z.string().min(1),
  intendedServices: z.array(z.string()).default([]),
  notes: z.string().nullable().optional(),
})

// POST /api/leads
leadsRoutes.post('/', zValidator('json', leadSchema), async (c) => {
  const id = await leads.createLead(depsFrom(c), actorFromJwt(c.get('jwtPayload'), 'web'), {
    ...c.req.valid('json'), linkCreatorTeam: true,
  })
  return c.json({ data: await leads.loadLead(c.env.DB, id) }, 201)
})

// PUT /api/leads/:id
leadsRoutes.put(
  '/:id',
  zValidator(
    'json',
    z.object({
      status: z.enum(leads.LEAD_STATUSES).optional(),
      notes: z.string().nullable().optional(),
      assignedToUserId: z.string().nullable().optional(),
      assignedToTeamId: z.string().nullable().optional(),
      contactInfo: z.string().optional(),
      intendedServices: z.array(z.string()).optional(),
      adInfo: z.record(z.string()).nullable().optional(),
      nextContactDate: z.string().nullable().optional(),
    }),
  ),
  async (c) => {
    const id = c.req.param('id')
    await leads.updateLead(depsFrom(c), actorFromJwt(c.get('jwtPayload'), 'web'), id, c.req.valid('json'))
    return c.json({ data: await leads.loadLead(c.env.DB, id) })
  },
)

// POST /api/leads/:id/status-transition
// 状态变更同时写一条跟进记录（必填字段校验由前端 workflow require_fields 动作承担）
leadsRoutes.post('/:id/status-transition', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<leads.StatusTransitionInput>()
  await leads.transitionLeadStatus(depsFrom(c), actorFromJwt(c.get('jwtPayload'), 'web'), id, body)
  return c.json({ data: await leads.loadLead(c.env.DB, id) })
})

leadsRoutes.delete('/:id', requireAdmin, async (c) => {
  const { id } = c.req.param()
  await leads.softDeleteLead(c.env.DB, actorFromJwt(c.get('jwtPayload'), 'web'), id)
  return c.json({ data: { id } })
})
