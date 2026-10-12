// 线索行为测试：以界面接口（/api/leads）的现有行为为标准，
// 要求 AI 助手工具、对外接口 /api/v1/leads、失败补录与之保持一致。
import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { executeTool } from '../src/crm/agent/executor'
import {
  api, createTeam, createUser, insertLead, leadRow, leadsCount, systemActivities, type TestUser,
} from './helpers'

function agentCtx(user: TestUser) {
  const pending: Promise<unknown>[] = []
  return {
    ctx: { db: env.DB, env, userId: user.id, role: user.role, teamId: user.teamId, waitUntil: (p: Promise<unknown>) => { pending.push(p) } },
    settle: () => Promise.allSettled(pending),
  }
}

let teamA: string, teamB: string
let admin: TestUser, salesA: TestUser, salesA2: TestUser, salesB: TestUser, ops: TestUser

beforeAll(async () => {
  teamA = await createTeam()
  teamB = await createTeam()
  admin = await createUser('admin')
  ops = await createUser('operations')
  salesA = await createUser('sales', teamA, 5)
  salesA2 = await createUser('sales', teamA, 5)
  salesB = await createUser('sales', teamB, 5)
})

describe('可见范围：销售能看到分给自己的 + 本团队未分配的线索', () => {
  let own: string, teamUnassigned: string, teammates: string, otherTeam: string

  beforeAll(async () => {
    own = await insertLead({ createdBy: admin.id, assignedTo: salesA.id, teamId: teamA, name: 'vis-own' })
    teamUnassigned = await insertLead({ createdBy: admin.id, assignedTo: null, teamId: teamA, name: 'vis-team' })
    teammates = await insertLead({ createdBy: admin.id, assignedTo: salesA2.id, teamId: teamA, name: 'vis-mate' })
    otherTeam = await insertLead({ createdBy: admin.id, assignedTo: null, teamId: teamB, name: 'vis-other' })
  })

  it('界面：列表与详情', async () => {
    const res = await api(salesA, 'GET', '/api/leads?search=vis-&pageSize=100')
    const ids = ((await res.json()) as { data: { id: string }[] }).data.map((l) => l.id)
    expect(ids).toContain(own)
    expect(ids).toContain(teamUnassigned)
    expect(ids).not.toContain(teammates)
    expect(ids).not.toContain(otherTeam)
    expect((await api(salesA, 'GET', `/api/leads/${teamUnassigned}`)).status).toBe(200)
    expect((await api(salesA, 'GET', `/api/leads/${teammates}`)).status).toBe(403)
  })

  it('AI 助手：query_leads / get_lead 与界面一致', async () => {
    const { ctx } = agentCtx(salesA)
    const out = await executeTool(ctx as never, 'query_leads', { search: 'vis-', pageSize: 50 }) as { leads: { id: string }[] }
    const ids = out.leads.map((l) => l.id)
    expect(ids).toContain(own)
    expect(ids).toContain(teamUnassigned)
    expect(ids).not.toContain(teammates)
    expect(ids).not.toContain(otherTeam)
    const detail = await executeTool(ctx as never, 'get_lead', { id: teamUnassigned }) as { id?: string; error?: string }
    expect(detail.id).toBe(teamUnassigned)
    const denied = await executeTool(ctx as never, 'get_lead', { id: teammates }) as { error?: string }
    expect(denied.error).toBeTruthy()
  })
})

describe('更新线索：附带处理', () => {
  it('界面：改为已丢失 → 负责人线索数 -1，写系统记录', async () => {
    const owner = await createUser('sales', teamA, 3)
    const id = await insertLead({ createdBy: admin.id, assignedTo: owner.id, teamId: teamA })
    const res = await api(owner, 'PUT', `/api/leads/${id}`, { status: 'Lost' })
    expect(res.status).toBe(200)
    expect(await leadsCount(owner.id)).toBe(2)
    expect((await systemActivities(id)).join()).toContain('已丢失')
  })

  it('界面：重新指派 → 旧负责人 -1，新负责人 +1', async () => {
    const from = await createUser('sales', teamA, 3)
    const to = await createUser('sales', teamA, 1)
    const id = await insertLead({ createdBy: admin.id, assignedTo: from.id, teamId: teamA })
    expect((await api(admin, 'PUT', `/api/leads/${id}`, { assignedToUserId: to.id })).status).toBe(200)
    expect(await leadsCount(from.id)).toBe(2)
    expect(await leadsCount(to.id)).toBe(2)
  })

  it('界面：非法状态值被拒绝', async () => {
    const id = await insertLead({ createdBy: admin.id, assignedTo: salesA.id, teamId: teamA })
    expect((await api(admin, 'PUT', `/api/leads/${id}`, { status: 'Bogus' })).status).toBe(400)
  })

  it('界面：不能跨团队指派（除非同时指定新团队）', async () => {
    const id = await insertLead({ createdBy: admin.id, assignedTo: salesA.id, teamId: teamA })
    expect((await api(admin, 'PUT', `/api/leads/${id}`, { assignedToUserId: salesB.id })).status).toBe(400)
  })

  it('界面：销售不能修改别人的线索；已转化线索不可修改', async () => {
    const mine = await insertLead({ createdBy: admin.id, assignedTo: salesA2.id, teamId: teamA })
    expect((await api(salesA, 'PUT', `/api/leads/${mine}`, { notes: 'x' })).status).toBe(403)
    const converted = await insertLead({ createdBy: admin.id, assignedTo: salesA.id, teamId: teamA, status: 'Converted' })
    expect((await api(admin, 'PUT', `/api/leads/${converted}`, { notes: 'x' })).status).toBe(403)
  })

  it('AI 助手：update_lead 改为已丢失 → 线索数 -1，写系统记录', async () => {
    const owner = await createUser('sales', teamA, 3)
    const id = await insertLead({ createdBy: admin.id, assignedTo: owner.id, teamId: teamA })
    const { ctx, settle } = agentCtx(owner)
    const out = await executeTool(ctx as never, 'update_lead', { id, status: 'Lost' }) as { success?: boolean; error?: string }
    await settle()
    expect(out.error).toBeUndefined()
    expect((await leadRow(id))?.status).toBe('Lost')
    expect(await leadsCount(owner.id)).toBe(2)
    expect((await systemActivities(id)).join()).toContain('已丢失')
  })

  it('AI 助手：update_lead 重新指派 → 线索数随之变化', async () => {
    const from = await createUser('sales', teamA, 3)
    const to = await createUser('sales', teamA, 1)
    const id = await insertLead({ createdBy: admin.id, assignedTo: from.id, teamId: teamA })
    const { ctx, settle } = agentCtx(admin)
    await executeTool(ctx as never, 'update_lead', { id, assignedToUserId: to.id })
    await settle()
    expect(await leadsCount(from.id)).toBe(2)
    expect(await leadsCount(to.id)).toBe(2)
  })

  it('AI 助手：非法状态值、跨团队指派被拒绝', async () => {
    const id = await insertLead({ createdBy: admin.id, assignedTo: salesA.id, teamId: teamA })
    const { ctx } = agentCtx(admin)
    expect((await executeTool(ctx as never, 'update_lead', { id, status: 'Bogus' }) as { error?: string }).error).toBeTruthy()
    expect((await executeTool(ctx as never, 'update_lead', { id, assignedToUserId: salesB.id }) as { error?: string }).error).toBeTruthy()
    expect((await leadRow(id))?.status).toBe('New')
    expect((await leadRow(id))?.assigned_to_userId).toBe(salesA.id)
  })
})

describe('状态流转（带跟进记录）', () => {
  it('改为已丢失：写跟进记录、记录丢失原因、负责人线索数 -1', async () => {
    const owner = await createUser('sales', teamA, 3)
    const id = await insertLead({ createdBy: admin.id, assignedTo: owner.id, teamId: teamA })
    const res = await api(owner, 'POST', `/api/leads/${id}/status-transition`, {
      targetStatus: 'Lost',
      activity: { activityType: 'Call', description: '不需要了', activityDate: '2026-10-12 10:00:00' },
      fields: { lostReason: '价格' },
    })
    expect(res.status).toBe(200)
    const row = await leadRow(id)
    expect(row?.status).toBe('Lost')
    expect(row?.lost_reason).toBe('价格')
    expect(await leadsCount(owner.id)).toBe(2)
    const act = await env.DB.prepare("SELECT description FROM sales_activities WHERE lead_id = ? AND activity_type = 'Call'")
      .bind(id).first<{ description: string }>()
    expect(act?.description).toContain('丢失原因：价格')
  })

  it('非法目标状态被拒绝', async () => {
    const id = await insertLead({ createdBy: admin.id, assignedTo: salesA.id, teamId: teamA })
    const res = await api(admin, 'POST', `/api/leads/${id}/status-transition`, {
      targetStatus: 'Bogus', activity: { activityType: 'Call', activityDate: '2026-10-12 10:00:00' },
    })
    expect(res.status).toBe(400)
  })
})

describe('新建线索', () => {
  it('界面新建：编号递增、预关联创建人团队', async () => {
    const res = await api(salesA, 'POST', '/api/leads', {
      source: '官网', name: '新建-界面', contactInfo: '13900000000', intendedServices: ['其他'],
    })
    expect(res.status).toBe(201)
    const lead = ((await res.json()) as { data: { id: string; leadNo: number; assignedToTeamId: string } }).data
    expect(lead.leadNo).toBeGreaterThan(0)
    expect(lead.assignedToTeamId).toBe(teamA)
  })

  it('对外接口：未收录的意向服务改为「其他」并写入备注', async () => {
    const key = `crm_test_${Date.now()}`
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))]
      .map((b) => b.toString(16).padStart(2, '0')).join('')
    await env.DB.prepare('INSERT INTO api_keys (id, user_id, key_hash, key_prefix) VALUES (?, ?, ?, ?)')
      .bind(`ak-${Date.now()}`, ops.id, hash, key.slice(0, 12)).run()
    const { exports } = await import('cloudflare:workers')
    const res = await exports.default.fetch('http://crm.test/api/v1/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
      body: JSON.stringify({ source: '广告', name: '新建-API', contactInfo: '13700000000', intendedServices: ['火星旅行'] }),
    })
    expect(res.status).toBe(201)
    const { id } = ((await res.json()) as { data: { id: string } }).data
    const row = await leadRow(id)
    expect(row?.intended_services).toBe('["其他"]')
    expect(String(row?.notes)).toContain('火星旅行')
  })

  it('失败补录：创建线索并标记已处理', async () => {
    const fid = `f-${Date.now()}`
    await env.DB.prepare('INSERT INTO api_lead_failures (id, request_body, error_message) VALUES (?, ?, ?)')
      .bind(fid, JSON.stringify({ source: '广告', name: '新建-补录', contactInfo: '13600000000', intendedServices: ['其他'] }), 'boom').run()
    const res = await api(admin, 'POST', `/api/admin/api-failures/${fid}/create-lead`)
    expect(res.status).toBe(201)
    const { leadId } = ((await res.json()) as { data: { leadId: string } }).data
    expect((await leadRow(leadId))?.name).toBe('新建-补录')
    const f = await env.DB.prepare('SELECT resolution FROM api_lead_failures WHERE id = ?').bind(fid).first<{ resolution: string }>()
    expect(f?.resolution).toBe('created_lead')
  })
})
