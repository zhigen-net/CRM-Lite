// 字段值校验：所有入口（界面接口、AI 助手 / MCP、对外接口）共用 domain 层规则
import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { executeTool } from '../src/crm/agent/executor'
import { normalizeExternalLead } from '../src/domain/leads/intake'
import { agentCtx, api, clientRow, createUser, insertClient, insertLead, leadRow, type TestUser } from './helpers'

let admin: TestUser

beforeAll(async () => {
  admin = await createUser('admin')
})

describe('合同状态、丢失原因必须是选项配置中的值', () => {
  it('界面：无效合同状态 400，有效值 200，清空 200', async () => {
    const id = await insertClient({ createdBy: admin.id })
    expect((await api(admin, 'PUT', `/api/clients/${id}`, { contractStatus: 'Bogus' })).status).toBe(400)
    expect((await clientRow(id))?.contract_status).toBeNull()
    expect((await api(admin, 'PUT', `/api/clients/${id}`, { contractStatus: 'Signed' })).status).toBe(200)
    expect((await api(admin, 'PUT', `/api/clients/${id}`, { contractStatus: null })).status).toBe(200)
  })

  it('历史数据里已停用的值原样保存不报错', async () => {
    const id = await insertClient({ createdBy: admin.id, contractStatus: 'LegacyStatus' })
    expect((await api(admin, 'PUT', `/api/clients/${id}`, { contractStatus: 'LegacyStatus', name: '改名' })).status).toBe(200)
  })

  it('界面：无效丢失原因 400（修改与状态流转都校验）', async () => {
    const id = await insertLead({ createdBy: admin.id })
    // 界面的 PUT 不接受 lostReason（只能在状态流转里填），传了也不会写入
    await api(admin, 'PUT', `/api/leads/${id}`, { lostReason: 'Bogus' })
    expect((await leadRow(id))?.lost_reason).toBeNull()
    const res = await api(admin, 'POST', `/api/leads/${id}/status-transition`, {
      targetStatus: 'Lost', activity: { activityType: 'Call', activityDate: '2026-10-12 10:00:00' }, fields: { lostReason: 'Bogus' },
    })
    expect(res.status).toBe(400)
    expect((await leadRow(id))?.status).toBe('New')
  })

  it('AI 助手 / MCP：返回错误并列出可选值', async () => {
    const id = await insertClient({ createdBy: admin.id })
    const { ctx } = agentCtx(admin)
    const out = await executeTool(ctx as never, 'update_client', { id, contractStatus: 'Bogus' }) as { error?: string }
    expect(out.error).toContain('Signed')
    const lead = await insertLead({ createdBy: admin.id })
    const lost = await executeTool(ctx as never, 'update_lead', { id: lead, status: 'Lost', lostReason: 'Bogus' }) as { error?: string }
    expect(lost.error).toContain('价格问题')
    expect((await leadRow(lead))?.status).toBe('New')
  })
})

describe('日期格式', () => {
  it('下次联系时间必须是真实的 YYYY-MM-DD', async () => {
    const id = await insertLead({ createdBy: admin.id })
    for (const bad of ['not-a-date', '2026/03/01', '2026-02-30', '2026-13-01']) {
      expect((await api(admin, 'PUT', `/api/leads/${id}`, { nextContactDate: bad })).status, bad).toBe(400)
    }
    expect((await leadRow(id))?.next_contact_date).toBeNull()
    expect((await api(admin, 'PUT', `/api/leads/${id}`, { nextContactDate: '2028-02-29' })).status).toBe(200)
    expect((await api(admin, 'PUT', `/api/leads/${id}`, { nextContactDate: null })).status).toBe(200)
    const client = await insertClient({ createdBy: admin.id })
    expect((await api(admin, 'PUT', `/api/clients/${client}`, { nextContactDate: '2026-02-30' })).status).toBe(400)
  })

  it('跟进时间接受日期或日期时间，拒绝非法值，且不覆盖线索的下次联系时间', async () => {
    const lead = await insertLead({ createdBy: admin.id })
    const post = (body: Record<string, unknown>) => api(admin, 'POST', '/api/activities', { leadId: lead, activityType: 'Call', ...body })
    expect((await post({ activityDate: '2026/13/40' })).status).toBe(400)
    expect((await post({ activityDate: '2026-10-12 25:00' })).status).toBe(400)
    expect((await post({ activityDate: '2026-10-12', nextContactDate: 'not-a-date' })).status).toBe(400)
    expect((await leadRow(lead))?.next_contact_date).toBeNull()
    for (const ok of ['2026-10-12', '2026-10-12T10:00', '2026-10-12 10:00:00', '2026-10-12T02:00:00.000Z']) {
      expect((await post({ activityDate: ok })).status, ok).toBe(201)
    }
  })
})

describe('外部线索整理：兜底服务本身不写「系统未收录」备注', () => {
  it('系统没有配置「其他」时，不传意向服务为空、传「其他」不产生提示', async () => {
    const services = await env.DB.prepare("SELECT COUNT(*) AS n FROM services WHERE deleted_at IS NULL AND name IN ('其他','其它','Other','Others')").first<{ n: number }>()
    expect(services?.n).toBe(0)
    const none = await normalizeExternalLead(env.DB, { source: 'x', name: 'x', contactInfo: 'x' })
    expect(none.intendedServices).toEqual([])
    expect(none.notes).toBeNull()
    const explicit = await normalizeExternalLead(env.DB, { source: 'x', name: 'x', contactInfo: 'x', intendedServices: ['其他', '火星旅行'] })
    expect(explicit.notes).toBe('意向服务（系统未收录）：火星旅行')
  })
})
