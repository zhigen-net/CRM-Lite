// 客户与跟进记录行为测试：界面接口与 AI 助手的权限、附带处理保持一致
import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { executeTool } from '../src/crm/agent/executor'
import {
  agentCtx, api, clientRow, clientSystemActivities, createTeam, createUser, insertClient, insertLead, leadRow, leadsCount,
  type TestUser,
} from './helpers'

let team: string
let admin: TestUser, sales: TestUser, otherSales: TestUser

beforeAll(async () => {
  team = await createTeam()
  admin = await createUser('admin')
  sales = await createUser('sales', team, 5)
  otherSales = await createUser('sales', team, 5)
})

describe('客户：可见范围与修改权限', () => {
  let mine: string, others: string
  beforeAll(async () => {
    mine = await insertClient({ createdBy: admin.id, assignedTo: sales.id, name: 'cv-mine' })
    others = await insertClient({ createdBy: admin.id, assignedTo: otherSales.id, name: 'cv-other' })
  })

  it('界面：销售只能看到自己的客户', async () => {
    const res = await api(sales, 'GET', '/api/clients?search=cv-&pageSize=100')
    const ids = ((await res.json()) as { data: { id: string }[] }).data.map((c) => c.id)
    expect(ids).toEqual([mine])
    expect((await api(sales, 'GET', `/api/clients/${others}`)).status).toBe(403)
  })

  it('AI 助手：query_clients / get_client 与界面一致', async () => {
    const { ctx } = agentCtx(sales)
    const out = await executeTool(ctx as never, 'query_clients', { search: 'cv-' }) as { clients: { id: string }[] }
    expect(out.clients.map((c) => c.id)).toEqual([mine])
    expect((await executeTool(ctx as never, 'get_client', { id: others }) as { error?: string }).error).toBeTruthy()
  })

  it('界面：销售不能修改别人的客户', async () => {
    expect((await api(sales, 'PUT', `/api/clients/${others}`, { phone: '1' })).status).toBe(403)
    expect((await clientRow(others))?.phone).toBeNull()
  })

  it('界面：修改自己的客户写系统变更记录', async () => {
    expect((await api(sales, 'PUT', `/api/clients/${mine}`, { contractStatus: 'Signed' })).status).toBe(200)
    expect((await clientSystemActivities(mine)).join()).toContain('合同状态')
  })

  it('AI 助手：update_client 写系统变更记录，并触发字段变化工作流', async () => {
    const wf = `wf-client-${Date.now()}`
    await env.DB.prepare('INSERT INTO workflows (id, name, entity_type, trigger, actions, is_active) VALUES (?, ?, ?, ?, ?, 1)')
      .bind(wf, 't', 'client', JSON.stringify({ type: 'field_change', field: 'contractStatus', to: 'Paid' }),
        JSON.stringify([{ type: 'set_field', field: 'email', value: 'wf@x.test' }])).run()
    const id = await insertClient({ createdBy: admin.id, assignedTo: sales.id })
    const { ctx, settle } = agentCtx(sales)
    const out = await executeTool(ctx as never, 'update_client', { id, contractStatus: 'Paid' }) as { error?: string }
    await settle()
    await env.DB.prepare('DELETE FROM workflows WHERE id = ?').bind(wf).run()
    expect(out.error).toBeUndefined()
    expect((await clientSystemActivities(id)).join()).toContain('合同状态')
    expect((await clientRow(id))?.email).toBe('wf@x.test')
  })
})

describe('线索转化为客户', () => {
  it('线索标记已转化、负责人线索数 -1、跟进记录迁移、写转化记录', async () => {
    const owner = await createUser('sales', team, 3)
    const leadId = await insertLead({ createdBy: admin.id, assignedTo: owner.id, teamId: team })
    await env.DB.prepare(
      "INSERT INTO sales_activities (id, lead_id, user_id, activity_type, description, activity_date) VALUES (?, ?, ?, 'Call', 'x', '2026-10-01')",
    ).bind(`act-${leadId}`, leadId, owner.id).run()

    const res = await api(owner, 'POST', '/api/clients', { leadId, name: '转化客户', assignedSalesUserId: owner.id })
    expect(res.status).toBe(201)
    const clientId = ((await res.json()) as { data: { id: string } }).data.id
    expect((await leadRow(leadId))?.status).toBe('Converted')
    expect(await leadsCount(owner.id)).toBe(2)
    const acts = await env.DB.prepare('SELECT activity_type FROM sales_activities WHERE client_id = ? ORDER BY activity_type')
      .bind(clientId).all<{ activity_type: string }>()
    expect(acts.results.map((a) => a.activity_type)).toEqual(['Call', 'System'])
  })

  it('已转化的线索不能重复转化；销售不能转化别人的线索', async () => {
    const converted = await insertLead({ createdBy: admin.id, assignedTo: sales.id, teamId: team, status: 'Converted' })
    expect((await api(admin, 'POST', '/api/clients', { leadId: converted, name: 'x' })).status).toBe(409)
    const others = await insertLead({ createdBy: admin.id, assignedTo: otherSales.id, teamId: team })
    expect((await api(sales, 'POST', '/api/clients', { leadId: others, name: 'x' })).status).toBe(403)
    expect((await leadRow(others))?.status).toBe('New')
  })
})

describe('跟进记录', () => {
  it('界面：销售不能给别人的线索写跟进', async () => {
    const others = await insertLead({ createdBy: admin.id, assignedTo: otherSales.id, teamId: team })
    const res = await api(sales, 'POST', '/api/activities', { leadId: others, activityType: 'Call', activityDate: '2026-10-12 10:00:00' })
    expect(res.status).toBe(403)
  })

  it('界面：写跟进同步下次联系时间，附件按表结构保存', async () => {
    const lead = await insertLead({ createdBy: admin.id, assignedTo: sales.id, teamId: team })
    const res = await api(sales, 'POST', '/api/activities', {
      leadId: lead, activityType: 'Call', activityDate: '2026-10-12 10:00:00', nextContactDate: '2026-10-20',
      attachmentKeys: [{ key: 'r2/a.pdf', name: 'a.pdf', size: 12 }],
    })
    expect(res.status).toBe(201)
    const act = ((await res.json()) as { data: { attachments: { key: string; name: string }[] } }).data
    expect(act.attachments).toEqual([{ key: 'r2/a.pdf', name: 'a.pdf', size: 12 }])
    expect((await leadRow(lead))?.next_contact_date).toBe('2026-10-20')
  })

  it('AI 助手：create_activity 有相同的权限检查', async () => {
    const others = await insertLead({ createdBy: admin.id, assignedTo: otherSales.id, teamId: team })
    const { ctx } = agentCtx(sales)
    const out = await executeTool(ctx as never, 'create_activity', {
      entityType: 'lead', entityId: others, activityType: 'Note', description: 'x', nextContactDate: '2026-12-01',
    }) as { error?: string }
    expect(out.error).toBeTruthy()
    expect((await leadRow(others))?.next_contact_date).toBeNull()
  })

  it('线索状态流转带附件：状态、跟进记录、附件一起保存', async () => {
    const lead = await insertLead({ createdBy: admin.id, assignedTo: sales.id, teamId: team })
    const res = await api(sales, 'POST', `/api/leads/${lead}/status-transition`, {
      targetStatus: 'Contacted',
      activity: { activityType: 'Call', activityDate: '2026-10-12 10:00:00', attachmentKeys: [{ key: 'r2/b.png', name: 'b.png', size: 3 }] },
    })
    expect(res.status).toBe(200)
    const att = await env.DB.prepare(
      `SELECT aa.file_name FROM activity_attachments aa JOIN sales_activities sa ON aa.activity_id = sa.id WHERE sa.lead_id = ?`,
    ).bind(lead).first<{ file_name: string }>()
    expect(att?.file_name).toBe('b.png')
  })
})

