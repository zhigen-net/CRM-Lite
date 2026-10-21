// 操作记录：线索、客户、跟进由业务服务记录（带改前改后），其它写操作按请求记录；只有管理员能查
import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { normalizePath } from '../src/crm/middleware/operationLog'
import { api, createUser, insertLead, type TestUser } from './helpers'

let admin: TestUser, sales: TestUser

type Op = { action: string; category: string; verb: string; via: string; status: string; summary: string | null
  changes: { field: string; from: unknown; to: unknown }[] | null; targetLabel: string | null; userName: string | null; errorMessage: string | null }

/** 部分记录在后台写入，轮询等待 */
async function ops(query: string, min = 1): Promise<Op[]> {
  let data: Op[] = []
  for (let i = 0; i < 20; i++) {
    data = ((await (await api(admin, 'GET', `/api/admin/audit-log?${query}`)).json()) as { data: Op[] }).data
    if (data.length >= min) break
    await new Promise((r) => setTimeout(r, 25))
  }
  return data
}

beforeAll(async () => {
  admin = await createUser('admin')
  sales = await createUser('sales')
})

describe('业务操作记录', () => {
  it('修改线索：记录操作人、对象名称和字段改前改后（备注保存完整内容）', async () => {
    const id = await insertLead({ createdBy: admin.id, assignedTo: admin.id, name: '审计线索' })
    expect((await api(admin, 'PUT', `/api/leads/${id}`, { name: '审计线索-改', contactInfo: '13900001111', notes: '完整备注内容' })).status).toBe(200)
    const [op] = await ops(`targetId=${id}&category=lead`)
    expect(op).toMatchObject({ action: 'lead.update', verb: 'update', via: 'web', status: 'ok', userName: admin.id })
    expect(op!.targetLabel).toMatch(/^L-\d{4} 审计线索-改$/)
    expect(op!.changes).toEqual(expect.arrayContaining([
      { field: 'name', from: '审计线索', to: '审计线索-改' },
      { field: 'contactInfo', from: '13800000000', to: '13900001111' },
      { field: 'notes', from: null, to: '完整备注内容' },
    ]))
  })

  it('新增跟进、删除线索都有记录；对象删除后名称仍在', async () => {
    const id = await insertLead({ createdBy: admin.id, assignedTo: admin.id, name: '待删除' })
    expect((await api(admin, 'POST', '/api/activities', { leadId: id, activityType: 'Call', description: '电话沟通', activityDate: '2026-01-01 10:00:00' })).status).toBe(201)
    expect((await api(admin, 'DELETE', `/api/leads/${id}`)).status).toBe(200)
    const list = await ops(`targetId=${id}`, 2)
    expect(list.map((o) => o.action).sort()).toEqual(['activity.create', 'lead.delete'])
    expect(list.find((o) => o.action === 'activity.create')?.summary).toContain('电话沟通')
    expect(list.every((o) => o.targetLabel?.endsWith('待删除'))).toBe(true)
  })
})

describe('按请求记录的操作', () => {
  it('系统设置修改、登录失败都有记录，密码不落库', async () => {
    expect((await api(admin, 'PUT', '/api/admin/settings', { company_name: '审计公司' })).status).toBeLessThan(500)
    const [setting] = await ops('category=settings')
    expect(setting).toMatchObject({ verb: 'update', userName: admin.id })

    expect((await api(null, 'POST', '/api/auth/login', { email: `${admin.id}@test.local`, password: 'wrong-pass' })).status).toBe(401)
    const [login] = await ops('category=login&status=error')
    expect(login).toMatchObject({ verb: 'login', userName: admin.id })
    const raw = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE input_summary LIKE '%wrong-pass%'").first<{ n: number }>()
    expect(raw!.n).toBe(0)
  })

  it('路径里的 ID 归一化', () => {
    expect(normalizePath('/api/users/9f1c2d3e-1111-2222-3333-444455556666')).toEqual({ route: '/api/users/:id', id: '9f1c2d3e-1111-2222-3333-444455556666' })
    expect(normalizePath('/api/admin/options/items/lead_status')).toEqual({ route: '/api/admin/options/items/lead_status', id: null })
  })

  it('只有管理员能查看操作记录', async () => {
    expect((await api(sales, 'GET', '/api/admin/audit-log')).status).toBe(403)
  })
})
