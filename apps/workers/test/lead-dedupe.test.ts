// 外部提交线索去重：30 天内同一联系方式合并到已有线索（所有外部入口一致）
import { env, exports } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { contactKey } from '../src/domain/leads/dedupe'
import { api, createUser, type TestUser } from './helpers'

let admin: TestUser, ops: TestUser
let apiKey: string, siteKey: string

const v1Lead = (body: Record<string, unknown>) => exports.default.fetch('http://crm.test/api/v1/leads', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey }, body: JSON.stringify(body),
})
const siteLead = (body: Record<string, unknown>) => exports.default.fetch('http://crm.test/api/t/lead', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Site-Key': siteKey, 'X-Visitor-Geo': encodeURIComponent(JSON.stringify({ ip: `198.51.100.${Math.floor(Math.random() * 250)}` })) },
  body: JSON.stringify(body),
})
const countByContact = async (like: string) =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM leads WHERE contact_info LIKE ? AND deleted_at IS NULL').bind(like).first<{ n: number }>())!.n

beforeAll(async () => {
  admin = await createUser('admin')
  ops = await createUser('operations')
  siteKey = ((await (await api(admin, 'POST', '/api/admin/tracking-sites', { name: '去重站', domain: 'dedupe.example' })).json()) as { data: { key: string } }).data.key
  apiKey = `crm_dedupe_${Date.now()}`
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('')
  await env.DB.prepare('INSERT INTO api_keys (id, user_id, key_hash, key_prefix) VALUES (?, ?, ?, ?)')
    .bind(`ak-dd-${Date.now()}`, ops.id, hash, apiKey.slice(0, 12)).run()
})

describe('联系方式比较', () => {
  it('电话只比较数字并去掉 +86，其它忽略大小写和空格', () => {
    expect(contactKey('+86 137-3187-1677')).toBe('13731871677')
    expect(contactKey('137 3187 1677')).toBe('13731871677')
    expect(contactKey(' A@Example.com ')).toBe('a@example.com')
    expect(contactKey('wxid_ABC')).toBe('wxid_abc')
  })
})

describe('30 天内同一联系方式合并到已有线索', () => {
  it('网站表单重复提交：不新建，返回成功，写跟进记录并补充意向服务和访客', async () => {
    const svc = `去重服务-${Date.now()}`
    await env.DB.prepare('INSERT INTO services (id, name) VALUES (?, ?)').bind(`svc-dd-${Date.now()}`, svc).run()
    expect((await siteLead({ name: '重复客户', phone: '13711112222', message: '第一次' })).status).toBe(200)
    const vid = crypto.randomUUID()
    const res = await siteLead({ name: '重复客户', phone: '137 1111 2222', message: '第二次', intendedServices: [svc], crm_vid: vid })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(await countByContact('137%1111%2222')).toBe(1)

    const lead = (await env.DB.prepare("SELECT * FROM leads WHERE contact_info = '13711112222'").first<Record<string, unknown>>())!
    expect(JSON.parse(String(lead.intended_services))).toContain(svc)
    expect(lead.visitor_id).toBe(vid)
    const act = await env.DB.prepare("SELECT description FROM sales_activities WHERE lead_id = ? AND activity_type = 'System'").bind(lead.id).first<{ description: string }>()
    expect(act?.description).toContain('客户再次提交')
    expect(act?.description).toContain('第二次')
    const sub = await env.DB.prepare("SELECT status, lead_id FROM site_lead_submissions WHERE lead_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").bind(lead.id).first()
    expect(sub).toMatchObject({ status: 'duplicate', lead_id: lead.id })
  })

  it('对外接口与网站表单共用规则：已有线索时返回 200 和 duplicate', async () => {
    const created = await v1Lead({ source: '推送', name: '跨入口', contactInfo: 'Cross@Example.com' })
    expect(created.status).toBe(201)
    const { id } = ((await created.json()) as { data: { id: string } }).data
    const again = await siteLead({ name: '跨入口', email: 'cross@example.com ' })
    expect(again.status).toBe(200)
    const dup = await v1Lead({ source: '推送', name: '跨入口', contactInfo: 'cross@example.com' })
    expect(dup.status).toBe(200)
    expect(await dup.json()).toEqual({ data: { id, duplicate: true } })
    expect(await countByContact('%ross@example.com')).toBe(1)
  })

  it('超过 30 天或已删除的线索不合并', async () => {
    const old = await v1Lead({ source: '推送', name: '老客户', contactInfo: '13722223333' })
    const { id } = ((await old.json()) as { data: { id: string } }).data
    await env.DB.prepare("UPDATE leads SET created_at = datetime('now', '-31 days') WHERE id = ?").bind(id).run()
    expect((await v1Lead({ source: '推送', name: '老客户', contactInfo: '13722223333' })).status).toBe(201)

    const del = await v1Lead({ source: '推送', name: '删除的', contactInfo: '13733334444' })
    const delId = ((await del.json()) as { data: { id: string } }).data.id
    await env.DB.prepare('UPDATE leads SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?').bind(delId).run()
    expect((await v1Lead({ source: '推送', name: '删除的', contactInfo: '13733334444' })).status).toBe(201)
  })
})

describe('连点与并发提交', () => {
  const resubmits = async (leadId: string) => (await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM sales_activities WHERE lead_id = ? AND description LIKE '客户再次提交%'",
  ).bind(leadId).first<{ n: number }>())!.n

  it('10 分钟内内容相同的重复提交不再写记录；有新留言时照常合并', async () => {
    const body = { name: '连点客户', phone: '13744445555', message: '想咨询' }
    expect((await siteLead(body)).status).toBe(200)
    expect((await siteLead(body)).status).toBe(200)
    expect((await siteLead(body)).status).toBe(200)
    const lead = (await env.DB.prepare("SELECT id FROM leads WHERE contact_info = '13744445555'").first<{ id: string }>())!
    expect(await resubmits(lead.id)).toBe(0)

    expect((await siteLead({ ...body, message: '补充：周末有空' })).status).toBe(200)
    expect(await resubmits(lead.id)).toBe(1)
    expect((await siteLead({ ...body, message: '补充：周末有空' })).status).toBe(200)
    expect(await resubmits(lead.id)).toBe(1)
    expect(await countByContact('13744445555')).toBe(1)
  })

  it('同一联系方式同时提交只建一条线索', async () => {
    const results = await Promise.all([1, 2, 3].map(() => v1Lead({ source: '推送', name: '并发', contactInfo: '13755556666' })))
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201])
    expect(await countByContact('13755556666')).toBe(1)
    const locks = await env.DB.prepare('SELECT COUNT(*) AS n FROM lead_submit_locks').first<{ n: number }>()
    expect(locks!.n).toBe(0)
  })
})

describe('相同联系方式的历史记录', () => {
  it('超过 30 天再次提交：新建线索并说明之前来过；界面接口列出相同联系方式的记录', async () => {
    const old = await v1Lead({ source: '推送', name: '回头客', contactInfo: '137 6666 7777' })
    const oldId = ((await old.json()) as { data: { id: string } }).data.id
    await env.DB.prepare("UPDATE leads SET created_at = datetime('now', '-40 days') WHERE id = ?").bind(oldId).run()

    const again = await v1Lead({ source: '推送', name: '回头客', contactInfo: '+86 13766667777' })
    expect(again.status).toBe(201)
    const newId = ((await again.json()) as { data: { id: string } }).data.id
    const note = await env.DB.prepare("SELECT description FROM sales_activities WHERE lead_id = ? AND description LIKE '该联系方式之前来过%'")
      .bind(newId).first<{ description: string }>()
    expect(note?.description).toContain('回头客')

    const res = await api(admin, 'GET', `/api/leads/contact-matches?contact=${encodeURIComponent('13766667777')}&excludeId=${newId}`)
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as { data: { id: string; type: string; canView: boolean }[] }
    expect(data).toEqual([expect.objectContaining({ id: oldId, type: 'lead', canView: true })])

    // 线索分配给别人后，销售能看到有重复，但不能打开
    await env.DB.prepare('UPDATE leads SET assigned_to_userId = ? WHERE id IN (?, ?)').bind(admin.id, oldId, newId).run()
    const sales = await createUser('sales')
    const salesRes = await api(sales, 'GET', `/api/leads/contact-matches?contact=13766667777`)
    const salesData = ((await salesRes.json()) as { data: { canView: boolean }[] }).data
    expect(salesData.length).toBe(2)
    expect(salesData.every((m) => !m.canView)).toBe(true)
  })
})
