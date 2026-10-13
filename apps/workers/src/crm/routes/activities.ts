import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { actorFromJwt, depsFrom } from '../../domain/actor'
import * as activities from '../../domain/activities/service'

// 跟进记录接口：只做参数解析与响应格式，业务规则在 domain/activities
export const activitiesRoutes = new Hono<{ Bindings: Env }>()

activitiesRoutes.use('*', requireAuth)

activitiesRoutes.get('/', async (c) => {
  const q = c.req.query()
  const result = await activities.listActivities(c.env.DB, actorFromJwt(c.get('jwtPayload'), 'web'), {
    clientId: q.clientId, leadId: q.leadId, search: q.search, activityType: q.activityType,
    assignedUserId: q.assignedUserId, entityType: q.entityType, activityDate: q.activityDate, nextContact: q.nextContact,
    page: parseInt(q.page ?? '1') || 1, pageSize: parseInt(q.pageSize ?? '20') || 20,
  })
  return c.json(result)
})

activitiesRoutes.post(
  '/',
  zValidator(
    'json',
    z.object({
      clientId: z.string().nullable().optional(),
      leadId: z.string().nullable().optional(),
      activityType: z.string().min(1, '请选择跟进类型'),
      description: z.string().nullable().optional(),
      activityDate: z.string().min(1),
      nextContactDate: z.string().nullable().optional(),
      extraData: z.record(z.unknown()).nullable().optional(),
      attachmentKeys: z.array(z.object({
        key: z.string(),
        name: z.string(),
        size: z.number(),
      })).optional().default([]),
    }),
  ),
  async (c) => {
    const { attachmentKeys, ...body } = c.req.valid('json')
    const id = await activities.createActivity(depsFrom(c), actorFromJwt(c.get('jwtPayload'), 'web'), {
      ...body, attachments: attachmentKeys,
    })
    return c.json({ data: await activities.loadActivity(c.env.DB, id) }, 201)
  },
)
