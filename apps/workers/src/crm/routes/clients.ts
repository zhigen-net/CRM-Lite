import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth, requireAdmin } from '../middleware/auth'
import { actorFromJwt, depsFrom } from '../../domain/actor'
import * as clients from '../../domain/clients/service'
import { getClientAttribution } from '../../domain/tracking/attribution'

// 客户接口：只做参数解析与响应格式，业务规则在 domain/clients
export const clientsRoutes = new Hono<{ Bindings: Env }>()

clientsRoutes.use('*', requireAuth)

// GET /api/clients
clientsRoutes.get('/', async (c) => {
  const q = c.req.query()
  const result = await clients.listClients(c.env.DB, actorFromJwt(c.get('jwtPayload'), 'web'), {
    search: q.search, contractStatus: q.contractStatus, assignedSalesUserId: q.assignedSalesUserId,
    createdAt: q.createdAt, nextContact: q.nextContact,
    page: Number(q.page ?? '1'), pageSize: Number(q.pageSize ?? '20'),
  })
  return c.json(result)
})

// GET /api/clients/:id
clientsRoutes.get('/:id', async (c) => {
  const client = await clients.getClient(c.env.DB, actorFromJwt(c.get('jwtPayload'), 'web'), c.req.param('id'))
  return c.json({ data: client })
})

// GET /api/clients/:id/attribution（转化前线索的来源与访问轨迹）
clientsRoutes.get('/:id/attribution', async (c) =>
  c.json({ data: await getClientAttribution(c.env.DB, actorFromJwt(c.get('jwtPayload'), 'web'), c.req.param('id')) }))

// POST /api/clients（带 leadId 时为线索转化）
clientsRoutes.post(
  '/',
  zValidator(
    'json',
    z.object({
      leadId: z.string().nullable().optional(),
      name: z.string().min(1),
      email: z.string().email().nullable().optional(),
      phone: z.string().nullable().optional(),
      detailedProfile: z.record(z.unknown()).optional(),
      servicePlans: z.array(z.string()).optional(),
      assignedSalesUserId: z.string().nullable().optional(),
    }),
  ),
  async (c) => {
    const id = await clients.createClient(depsFrom(c), actorFromJwt(c.get('jwtPayload'), 'web'), c.req.valid('json'))
    return c.json({ data: await clients.loadClient(c.env.DB, id) }, 201)
  },
)

// PUT /api/clients/:id
clientsRoutes.put(
  '/:id',
  zValidator(
    'json',
    z.object({
      name: z.string().optional(),
      email: z.string().email().nullable().optional(),
      phone: z.string().nullable().optional(),
      detailedProfile: z.record(z.unknown()).optional(),
      servicePlans: z.array(z.string()).optional(),
      contractStatus: z.string().nullable().optional(),
      assignedSalesUserId: z.string().nullable().optional(),
      nextContactDate: z.string().nullable().optional(),
    }),
  ),
  async (c) => {
    const id = c.req.param('id')
    await clients.updateClient(depsFrom(c), actorFromJwt(c.get('jwtPayload'), 'web'), id, c.req.valid('json'))
    return c.json({ data: await clients.loadClient(c.env.DB, id) })
  },
)

clientsRoutes.delete('/:id', requireAdmin, async (c) => {
  const { id } = c.req.param()
  await clients.softDeleteClient(c.env.DB, actorFromJwt(c.get('jwtPayload'), 'web'), id)
  return c.json({ data: { id } })
})
