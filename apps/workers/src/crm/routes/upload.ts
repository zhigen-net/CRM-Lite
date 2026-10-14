import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { HTTPException } from 'hono/http-exception'
import { requireAuth } from '../middleware/auth'
import { toCamelList } from '../../shared/db'
import { actorFromJwt } from '../../domain/actor'
import { assertCanDownloadFile } from '../../domain/files'

export const uploadRoutes = new Hono<{ Bindings: Env }>()

uploadRoutes.use('*', requireAuth)

// POST /api/upload/internal - 内部文件上传（直接写入 R2）
uploadRoutes.post('/internal', async (c) => {
  const formData = await c.req.formData()
  const file = formData.get('file') as File | null
  if (!file) return c.json({ message: '未提供文件' }, 400)

  const key = `internal-docs/${uuidv4()}-${file.name}`
  await c.env.STORAGE.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  })

  return c.json({ data: { key, name: file.name, size: file.size } }, 201)
})

// ─── 实体附件（服务 / 合作伙伴） ───────────────────────────────────────────

const ALLOWED_ENTITY_TYPES = ['service', 'partner', 'product'] as const
type EntityType = typeof ALLOWED_ENTITY_TYPES[number]

// GET /api/upload/attachments?entityType=service&entityId=xxx
uploadRoutes.get(
  '/attachments',
  zValidator('query', z.object({
    entityType: z.enum(ALLOWED_ENTITY_TYPES),
    entityId: z.string().min(1),
  })),
  async (c) => {
    const { entityType, entityId } = c.req.valid('query')
    const rows = await c.env.DB.prepare(
      'SELECT * FROM entity_attachments WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC',
    ).bind(entityType, entityId).all()
    return c.json({ data: toCamelList(rows.results as Record<string, unknown>[]) })
  },
)

// POST /api/upload/attachments?entityType=service&entityId=xxx (multipart)
uploadRoutes.post(
  '/attachments',
  zValidator('query', z.object({
    entityType: z.enum(ALLOWED_ENTITY_TYPES),
    entityId: z.string().min(1),
  })),
  async (c) => {
    const { entityType, entityId } = c.req.valid('query')
    const { userId } = c.get('jwtPayload')

    const formData = await c.req.formData()
    const file = formData.get('file') as File | null
    if (!file) return c.json({ message: '未提供文件' }, 400)

    const id = uuidv4()
    const fileKey = `${entityType}-docs/${entityId}/${id}-${file.name}`
    await c.env.STORAGE.put(fileKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    })

    await c.env.DB.prepare(
      'INSERT INTO entity_attachments (id, entity_type, entity_id, name, file_key, size, mime_type, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(id, entityType, entityId, file.name, fileKey, file.size, file.type || null, userId).run()

    return c.json({ data: { id, name: file.name, fileKey, size: file.size, mimeType: file.type } }, 201)
  },
)

// DELETE /api/upload/attachments/:id
uploadRoutes.delete('/attachments/:id', async (c) => {
  const id = c.req.param('id')
  const att = await c.env.DB.prepare(
    'SELECT file_key FROM entity_attachments WHERE id = ?',
  ).bind(id).first<{ file_key: string }>()
  if (!att) throw new HTTPException(404, { message: '附件不存在' })

  await c.env.STORAGE.delete(att.file_key)
  await c.env.DB.prepare('DELETE FROM entity_attachments WHERE id = ?').bind(id).run()
  return c.json({ data: { success: true } })
})

// GET /api/upload/file?key=xxx - 内部文件下载（流式代理）
uploadRoutes.get(
  '/file',
  zValidator('query', z.object({ key: z.string().min(1) })),
  async (c) => {
    const { key } = c.req.valid('query')
    await assertCanDownloadFile(c.env.DB, actorFromJwt(c.get('jwtPayload'), 'web'), key)
    const obj = await c.env.STORAGE.get(key)
    if (!obj) return c.json({ message: '文件不存在' }, 404)
    const fileName = key.split('/').pop() ?? 'file'
    return new Response(obj.body as ReadableStream, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    })
  },
)

