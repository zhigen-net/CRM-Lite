// 删除/恢复线索时的线索数，以及文件下载权限
import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { api, createTeam, createUser, insertClient, insertLead, leadsCount, type TestUser } from './helpers'

let team: string
let admin: TestUser, ops: TestUser, sales: TestUser, other: TestUser

beforeAll(async () => {
  team = await createTeam()
  admin = await createUser('admin')
  ops = await createUser('operations')
  sales = await createUser('sales', team, 0)
  other = await createUser('sales', team, 0)
})

describe('删除与恢复线索（按实际数据重新统计负责人线索数）', () => {
  it('删除进行中的线索：负责人线索数 -1；恢复后 +1', async () => {
    const owner = await createUser('sales', team, 0)
    const id = await insertLead({ createdBy: admin.id, assignedTo: owner.id, teamId: team })
    await insertLead({ createdBy: admin.id, assignedTo: owner.id, teamId: team })
    expect((await api(admin, 'DELETE', `/api/leads/${id}`)).status).toBe(200)
    expect(await leadsCount(owner.id)).toBe(1)
    expect((await api(admin, 'POST', `/api/admin/recycle-bin/lead/${id}/restore`)).status).toBe(200)
    expect(await leadsCount(owner.id)).toBe(2)
    expect((await api(admin, 'GET', `/api/leads/${id}`)).status).toBe(200)
  })

  it('删除或恢复已丢失的线索：线索数不变', async () => {
    const owner = await createUser('sales', team, 0)
    await insertLead({ createdBy: admin.id, assignedTo: owner.id, teamId: team })
    const id = await insertLead({ createdBy: admin.id, assignedTo: owner.id, teamId: team, status: 'Lost' })
    await api(admin, 'DELETE', `/api/leads/${id}`)
    expect(await leadsCount(owner.id)).toBe(1)
    await api(admin, 'POST', `/api/admin/recycle-bin/lead/${id}/restore`)
    expect(await leadsCount(owner.id)).toBe(1)
  })

  it('旧版本删除（当时未减计数）的线索恢复后，线索数仍然正确', async () => {
    const owner = await createUser('sales', team, 1)
    const id = await insertLead({ createdBy: admin.id, assignedTo: owner.id, teamId: team })
    // 模拟旧版本的删除：只打删除标记，没有减计数
    await env.DB.prepare('UPDATE leads SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').bind(id).run()
    await api(admin, 'POST', `/api/admin/recycle-bin/lead/${id}/restore`)
    expect(await leadsCount(owner.id)).toBe(1)
  })

  it('同时发两次恢复请求，线索数只算一次', async () => {
    const owner = await createUser('sales', team, 0)
    const id = await insertLead({ createdBy: admin.id, assignedTo: owner.id, teamId: team })
    await env.DB.prepare('UPDATE leads SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').bind(id).run()
    await Promise.all([
      api(admin, 'POST', `/api/admin/recycle-bin/lead/${id}/restore`),
      api(admin, 'POST', `/api/admin/recycle-bin/lead/${id}/restore`),
    ])
    expect(await leadsCount(owner.id)).toBe(1)
  })

  it('恢复未删除的线索 404', async () => {
    const id = await insertLead({ createdBy: admin.id })
    expect((await api(admin, 'POST', `/api/admin/recycle-bin/lead/${id}/restore`)).status).toBe(404)
  })
})

describe('文件下载权限', () => {
  async function putFile(key: string) {
    await env.STORAGE.put(key, 'content')
  }
  async function attachToActivity(key: string, target: { leadId?: string; clientId?: string }, userId: string) {
    const actId = crypto.randomUUID()
    await env.DB.prepare(
      "INSERT INTO sales_activities (id, lead_id, client_id, user_id, activity_type, activity_date) VALUES (?, ?, ?, ?, 'Call', '2026-10-01')",
    ).bind(actId, target.leadId ?? null, target.clientId ?? null, userId).run()
    await env.DB.prepare('INSERT INTO activity_attachments (id, activity_id, r2_object_key, file_name) VALUES (?, ?, ?, ?)')
      .bind(crypto.randomUUID(), actId, key, 'f.txt').run()
  }
  const get = (u: TestUser, key: string) => api(u, 'GET', `/api/upload/file?key=${encodeURIComponent(key)}`)

  it('销售能下载自己线索和客户的附件，不能下载别人的', async () => {
    const myLead = await insertLead({ createdBy: admin.id, assignedTo: sales.id, teamId: team })
    const othersLead = await insertLead({ createdBy: admin.id, assignedTo: other.id, teamId: team })
    const myClient = await insertClient({ createdBy: admin.id, assignedTo: sales.id })
    const k1 = `internal-docs/${crypto.randomUUID()}-a.txt`
    const k2 = `internal-docs/${crypto.randomUUID()}-b.txt`
    const k3 = `internal-docs/${crypto.randomUUID()}-c.txt`
    for (const k of [k1, k2, k3]) await putFile(k)
    await attachToActivity(k1, { leadId: myLead }, sales.id)
    await attachToActivity(k2, { leadId: othersLead }, other.id)
    await attachToActivity(k3, { clientId: myClient }, sales.id)

    expect((await get(sales, k1)).status).toBe(200)
    expect((await get(sales, k3)).status).toBe(200)
    expect((await get(sales, k2)).status).toBe(404)
    expect((await get(admin, k2)).status).toBe(200)
    expect((await get(ops, k2)).status).toBe(200)
  })

  it('产品库资料所有员工都能下载', async () => {
    const key = `product-docs/p1/${crypto.randomUUID()}-spec.pdf`
    await putFile(key)
    await env.DB.prepare("INSERT INTO entity_attachments (id, entity_type, entity_id, name, file_key) VALUES (?, 'product', 'p1', 'spec.pdf', ?)")
      .bind(crypto.randomUUID(), key).run()
    expect((await get(sales, key)).status).toBe(200)
  })

  it('未关联业务对象的文件（如客户门户资料）销售不能下载', async () => {
    const key = `client-resources/${crypto.randomUUID()}-report.pdf`
    await putFile(key)
    expect((await get(sales, key)).status).toBe(404)
    expect((await get(admin, key)).status).toBe(200)
  })
})
