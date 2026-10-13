// 工作流修改数据时与界面走同一套业务规则：线索数等附带处理保持一致，且不会互相触发造成循环
import { env } from 'cloudflare:workers'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { executeScheduledWorkflows } from '../src/crm/workflow/executor'
import { api, createTeam, createUser, insertLead, leadRow, leadsCount, systemActivities, type TestUser } from './helpers'

let team: string
let admin: TestUser
const created: string[] = []

async function addWorkflow(entity: string, trigger: unknown, actions: unknown[]) {
  const id = `wf-${crypto.randomUUID()}`
  await env.DB.prepare('INSERT INTO workflows (id, name, entity_type, trigger, actions, is_active) VALUES (?, ?, ?, ?, ?, 1)')
    .bind(id, id, entity, JSON.stringify(trigger), JSON.stringify(actions)).run()
  created.push(id)
}

async function waitFor(check: () => Promise<boolean>) {
  for (let i = 0; i < 50; i++) {
    if (await check()) return true
    await new Promise((r) => setTimeout(r, 20))
  }
  return false
}

beforeAll(async () => {
  team = await createTeam()
  admin = await createUser('admin')
})
afterEach(async () => {
  for (const id of created.splice(0)) await env.DB.prepare('DELETE FROM workflows WHERE id = ?').bind(id).run()
})

describe('工作流修改字段', () => {
  it('字段变化触发的工作流把线索改为已丢失：负责人线索数随之 -1', async () => {
    const owner = await createUser('sales', team, 3)
    const id = await insertLead({ createdBy: admin.id, assignedTo: null, teamId: team })
    await addWorkflow('lead', { type: 'field_change', field: 'assignedToUserId', to: '*' },
      [{ type: 'set_field', field: 'status', label: '状态', value: 'Lost' }])

    expect((await api(admin, 'PUT', `/api/leads/${id}`, { assignedToUserId: owner.id })).status).toBe(200)
    expect(await waitFor(async () => (await leadRow(id))?.status === 'Lost')).toBe(true)
    // 指派 +1，工作流改为已丢失 -1
    expect(await leadsCount(owner.id)).toBe(3)
  })

  it('定时工作流（下次联系已过期）把线索改为已丢失：负责人线索数 -1', async () => {
    const owner = await createUser('sales', team, 3)
    const id = await insertLead({ createdBy: admin.id, assignedTo: owner.id, teamId: team })
    await env.DB.prepare("UPDATE leads SET next_contact_date = '2000-01-01' WHERE id = ?").bind(id).run()
    await addWorkflow('lead', { type: 'scheduled', condition: 'date_overdue', field: 'nextContactDate' },
      [{ type: 'set_field', field: 'status', label: '状态', value: 'Lost' }])

    await executeScheduledWorkflows(env.DB, env)
    expect((await leadRow(id))?.status).toBe('Lost')
    expect(await leadsCount(owner.id)).toBe(2)
  })

  it('意向服务按顿号/逗号拆成列表保存', async () => {
    const id = await insertLead({ createdBy: admin.id, assignedTo: null, teamId: team })
    await env.DB.prepare("UPDATE leads SET next_contact_date = '2000-01-02' WHERE id = ?").bind(id).run()
    await addWorkflow('lead', { type: 'scheduled', condition: 'date_overdue', field: 'nextContactDate' },
      [{ type: 'set_field', field: 'intendedServices', label: '意向服务', value: 'A、B,C' }])

    await executeScheduledWorkflows(env.DB, env)
    expect((await leadRow(id))?.intended_services).toBe('["A","B","C"]')
  })

  it('非法状态值被拒绝，线索保持原状', async () => {
    const id = await insertLead({ createdBy: admin.id, assignedTo: null, teamId: team })
    await env.DB.prepare("UPDATE leads SET next_contact_date = '2000-01-03' WHERE id = ?").bind(id).run()
    await addWorkflow('lead', { type: 'scheduled', condition: 'date_overdue', field: 'nextContactDate' },
      [{ type: 'set_field', field: 'status', label: '状态', value: 'Bogus' }])

    await executeScheduledWorkflows(env.DB, env)
    expect((await leadRow(id))?.status).toBe('New')
  })

  it('工作流做的修改不再触发其它工作流，也不写系统变更记录', async () => {
    const owner = await createUser('sales', team, 3)
    const id = await insertLead({ createdBy: admin.id, assignedTo: null, teamId: team })
    await addWorkflow('lead', { type: 'field_change', field: 'assignedToUserId', to: '*' },
      [{ type: 'set_field', field: 'status', label: '状态', value: 'Contacted' }])
    await addWorkflow('lead', { type: 'field_change', field: 'status', to: 'Contacted' },
      [{ type: 'set_field', field: 'notes', label: '备注', value: 'chained' }])

    await api(admin, 'PUT', `/api/leads/${id}`, { assignedToUserId: owner.id })
    expect(await waitFor(async () => (await leadRow(id))?.status === 'Contacted')).toBe(true)
    await new Promise((r) => setTimeout(r, 200))
    expect((await leadRow(id))?.notes).toBeNull()
    expect(await systemActivities(id)).toEqual(['负责人已变更'])
  })
})
