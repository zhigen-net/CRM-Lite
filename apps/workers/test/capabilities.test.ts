// 能力注册表：定义完整性、scope 限制、输入校验；AI 助手工具由注册表生成
import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { CAPABILITIES, SCOPES, capabilitiesFor, invokeCapability } from '../src/domain/capabilities'
import { actorFromJwt } from '../src/domain/actor'
import { DomainError } from '../src/domain/errors'
import { CRM_TOOLS } from '../src/crm/agent/tools'
import { executeTool } from '../src/crm/agent/executor'
import { agentCtx, createUser, insertLead, leadRow, type TestUser } from './helpers'

let admin: TestUser
const deps = { db: env.DB, env, waitUntil: () => {} }
const actor = () => actorFromJwt(admin, 'assistant')

async function statusOf(p: Promise<unknown>): Promise<number | 'ok'> {
  try { await p; return 'ok' } catch (e) { if (e instanceof DomainError) return e.status; throw e }
}

beforeAll(async () => {
  admin = await createUser('admin')
})

describe('能力定义', () => {
  it('名称唯一、scope 合法、必填字段都已声明', () => {
    const names = CAPABILITIES.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
    for (const c of CAPABILITIES) {
      if (c.scope !== null) expect(SCOPES).toContain(c.scope)
      for (const r of c.inputSchema.required ?? []) expect(Object.keys(c.inputSchema.properties)).toContain(r)
    }
  })

  it('AI 助手工具与注册表一致', () => {
    expect(CRM_TOOLS.map((t) => t.name)).toEqual(CAPABILITIES.map((c) => c.name))
  })

  it('按 scope 过滤可用能力', () => {
    const names = capabilitiesFor(['leads:read']).map((c) => c.name)
    expect(names).toContain('query_leads')
    expect(names).not.toContain('update_lead')
    expect(capabilitiesFor().length).toBe(CAPABILITIES.length)
  })
})

describe('invokeCapability', () => {
  it('授权不含所需 scope 时拒绝（403），不写库', async () => {
    const id = await insertLead({ createdBy: admin.id })
    expect(await statusOf(invokeCapability(deps, actor(), 'update_lead', { id, status: 'Lost' }, ['leads:read']))).toBe(403)
    expect((await leadRow(id))?.status).toBe('New')
    expect(await statusOf(invokeCapability(deps, actor(), 'get_lead', { id }, ['leads:read']))).toBe('ok')
  })

  it('未知能力 404；缺少必填、枚举不符 400', async () => {
    expect(await statusOf(invokeCapability(deps, actor(), 'drop_database', {}))).toBe(404)
    expect(await statusOf(invokeCapability(deps, actor(), 'get_lead', {}))).toBe(400)
    expect(await statusOf(invokeCapability(deps, actor(), 'query_leads', { nextContact: 'someday' }))).toBe(400)
    expect(await statusOf(invokeCapability(deps, actor(), 'get_options', { groupKey: 'secrets' }))).toBe(400)
  })

  it('宽松转换字符串数字，丢弃未声明字段', async () => {
    const out = await invokeCapability(deps, actor(), 'query_leads', { pageSize: '1', dropTable: 'leads' }) as { leads: unknown[] }
    expect(out.leads.length).toBeLessThanOrEqual(1)
    expect(await statusOf(invokeCapability(deps, actor(), 'query_leads', { pageSize: 'abc' }))).toBe(400)
  })

  it('AI 助手入口把业务错误转为 { error }', async () => {
    const { ctx } = agentCtx(admin)
    expect((await executeTool(ctx as never, 'drop_database', {}) as { error?: string }).error).toContain('未知工具')
    expect((await executeTool(ctx as never, 'get_lead', {}) as { error?: string }).error).toContain('id')
  })
})
