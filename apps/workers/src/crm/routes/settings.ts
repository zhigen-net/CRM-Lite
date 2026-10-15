import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth, requireAdmin } from '../middleware/auth'

export const settingsRoutes = new Hono<{ Bindings: Env }>()

settingsRoutes.use('*', requireAuth, requireAdmin)

// GET /api/admin/settings
settingsRoutes.get('/', async (c) => {
  const results = await c.env.DB.prepare('SELECT key, value FROM system_settings').all<{
    key: string; value: string
  }>()
  const settings = Object.fromEntries(results.results.map((r) => [r.key, r.value]))
  return c.json({ data: settings })
})

// PUT /api/admin/settings
settingsRoutes.put(
  '/',
  zValidator(
    'json',
    z.object({
      system_name:          z.string().optional(),
      smtp_host:            z.string().optional(),
      smtp_port:            z.string().optional(),
      smtp_secure:          z.string().optional(),
      smtp_user:            z.string().optional(),
      smtp_password:        z.string().optional(),
      smtp_from_email:      z.string().optional(),
      smtp_from_name:       z.string().optional(),
      auto_assign_enabled:  z.string().optional(),
      ai_agent_enabled:     z.string().optional(),
      timezone:             z.string().optional(),
      industry_context:     z.string().max(2000).optional(),
    }),
  ),
  async (c) => {
    const body = c.req.valid('json')
    const entries = Object.entries(body).filter(([, v]) => v !== undefined) as [string, string][]

    for (const [key, value] of entries) {
      await c.env.DB.prepare(
        'INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP',
      ).bind(key, value).run()
    }

    const results = await c.env.DB.prepare('SELECT key, value FROM system_settings').all<{
      key: string; value: string
    }>()
    const settings = Object.fromEntries(results.results.map((r) => [r.key, r.value]))
    return c.json({ data: settings })
  },
)
