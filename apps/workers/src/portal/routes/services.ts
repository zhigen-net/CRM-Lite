import { Hono } from 'hono'
import { requirePortalAuth } from '../middleware/auth'
import { toCamel } from '../../shared/db'

export const servicesRoutes = new Hono<{ Bindings: Env }>()

servicesRoutes.use('*', requirePortalAuth)

servicesRoutes.get('/', async (c) => {
  const { clientId } = c.get('portalPayload')

  // 查询客户订购的服务（通过 service_plan 关联）
  const client = await c.env.DB.prepare(
    'SELECT service_plan, contract_status FROM clients WHERE id = ?',
  ).bind(clientId).first<{ service_plan: string | null; contract_status: string | null }>()

  if (!client?.service_plan) return c.json({ data: [] })

  const service = await c.env.DB.prepare(
    'SELECT id, name, description, process_steps FROM services WHERE name = ?',
  ).bind(client.service_plan).first()

  return c.json({
    data: service
      ? [{ ...(toCamel(service as Record<string, unknown>) as Record<string, unknown>), contractStatus: client.contract_status }]
      : [],
  })
})
