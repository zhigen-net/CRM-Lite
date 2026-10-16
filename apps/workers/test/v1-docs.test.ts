// 对外接口的机器可读说明与试运行：说明要反映实时服务列表；试运行不能产生任何数据
import { env, exports } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { createUser, type TestUser } from './helpers'

let ops: TestUser
let key: string
const serviceName = `试运行服务-${Date.now()}`

const v1 = (path: string, init?: RequestInit) => exports.default.fetch(`http://crm.test/api/v1${path}`, init)
const postLead = (query: string, body: unknown, apiKey = key) => v1(`/leads${query}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
  body: JSON.stringify(body),
})
const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())?.n ?? -1

beforeAll(async () => {
  ops = await createUser('operations')
  key = `crm_dry_${Date.now()}`
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('')
  await env.DB.prepare('INSERT INTO api_keys (id, user_id, key_hash, key_prefix) VALUES (?, ?, ?, ?)')
    .bind(`ak-dry-${Date.now()}`, ops.id, hash, key.slice(0, 12)).run()
  await env.DB.prepare('INSERT INTO services (id, name) VALUES (?, ?)').bind(`svc-${Date.now()}`, serviceName).run()
})

describe('机器可读说明', () => {
  it('llms.txt 无需鉴权，包含完整地址、实时服务列表和试运行说明', async () => {
    const res = await v1('/llms.txt')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/markdown')
    const text = await res.text()
    expect(text).toContain('POST http://crm.test/api/v1/leads')
    expect(text).toContain(serviceName)
    expect(text).toContain('?dryRun=1')
    expect(text).toContain('http://crm.test/api/v1/openapi.json')
    expect(text).toContain('crm_vid')
  })

  it('openapi.json 无需鉴权，描述鉴权方式、必填字段和服务列表', async () => {
    const res = await v1('/openapi.json')
    expect(res.status).toBe(200)
    const doc = (await res.json()) as {
      servers: { url: string }[]
      components: { securitySchemes: { apiKey: { name: string } }; schemas: { LeadInput: { required: string[]; properties: { intendedServices: { description: string } } } } }
      paths: Record<string, unknown>
    }
    expect(doc.servers[0]?.url).toBe('http://crm.test/api/v1')
    expect(doc.components.securitySchemes.apiKey.name).toBe('X-API-Key')
    expect(doc.components.schemas.LeadInput.required).toEqual(['source', 'name', 'contactInfo', 'intendedServices'])
    expect(doc.components.schemas.LeadInput.properties.intendedServices.description).toContain(serviceName)
    expect(doc.paths['/leads']).toBeDefined()
  })
})

describe('试运行 dryRun', () => {
  it('返回整理结果，不创建线索、不改计数、不记失败', async () => {
    const before = {
      leads: await count('SELECT COUNT(*) AS n FROM leads'),
      failures: await count('SELECT COUNT(*) AS n FROM api_lead_failures'),
    }
    const res = await postLead('?dryRun=1', {
      source: '接入测试', name: '试运行', contactInfo: '13600000000',
      intendedServices: [serviceName, '火星旅行'], campaign: '计划A', pageTitle: '落地页',
    })
    expect(res.status).toBe(200)
    const { data } = (await res.json()) as {
      data: { dryRun: boolean; lead: { intendedServices: string[]; notes: string; adInfo: Record<string, string> } }
    }
    expect(data.dryRun).toBe(true)
    expect(data.lead.intendedServices).toEqual([serviceName, '其他'])
    expect(data.lead.notes).toContain('火星旅行')
    expect(data.lead.notes).toContain('pageTitle')
    expect(data.lead.adInfo['广告计划']).toBe('计划A')
    expect(await count('SELECT COUNT(*) AS n FROM leads')).toBe(before.leads)
    expect(await count('SELECT COUNT(*) AS n FROM api_lead_failures')).toBe(before.failures)
  })

  it('同样校验密钥和必填字段', async () => {
    expect((await postLead('?dryRun=1', { source: 'x', name: 'x', contactInfo: 'x', intendedServices: ['其他'] }, 'crm_wrong')).status).toBe(401)
    expect((await postLead('?dryRun=1', { source: 'x', name: 'x', intendedServices: ['其他'] })).status).toBe(400)
  })

  it('不带 dryRun 时照常创建', async () => {
    const res = await postLead('', { source: '接入测试', name: '真实', contactInfo: '13600000001', intendedServices: [serviceName] })
    expect(res.status).toBe(201)
  })
})
