// 行业模板：空白模板清除迁移内置的行业示例数据；辅助生殖模板保留并写入业务背景
// 会修改共享的种子数据，测试结束时还原，避免影响其它测试
import { env } from 'cloudflare:workers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyIndustryTemplate, getIndustryContext, industryContextBlock } from '../src/domain/templates'
import { api, createUser } from './helpers'

type Row = Record<string, unknown>
let snapshot: { services: Row[]; options: Row[]; prompts: Row[]; context: Row | null }

async function restoreRows(table: string, rows: Row[]) {
  for (const r of rows) {
    const cols = Object.keys(r)
    await env.DB.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .bind(...cols.map((c) => r[c])).run()
  }
}

beforeAll(async () => {
  snapshot = {
    services: (await env.DB.prepare("SELECT * FROM services WHERE id IN ('svc-001','svc-002','svc-003','svc-004')").all<Row>()).results,
    options: (await env.DB.prepare("SELECT * FROM option_items WHERE group_key = 'partner_type'").all<Row>()).results,
    prompts: (await env.DB.prepare("SELECT * FROM ai_prompts WHERE id IN ('builtin-lead-analysis','builtin-client-analysis')").all<Row>()).results,
    context: await env.DB.prepare("SELECT * FROM system_settings WHERE key = 'industry_context'").first<Row>(),
  }
})

afterAll(async () => {
  await env.DB.prepare("DELETE FROM option_items WHERE group_key = 'partner_type'").run()
  await restoreRows('services', snapshot.services)
  await restoreRows('option_items', snapshot.options)
  await restoreRows('ai_prompts', snapshot.prompts)
  await env.DB.prepare("DELETE FROM system_settings WHERE key = 'industry_context'").run()
  if (snapshot.context) await restoreRows('system_settings', [snapshot.context])
})

describe('行业模板', () => {
  it('迁移内置了辅助生殖示例数据（新库的初始状态）', () => {
    expect(snapshot.services.length).toBe(4)
    expect(String(snapshot.prompts[0]?.system_prompt)).toContain('辅助生殖')
  })

  it('辅助生殖模板：保留示例数据，写入业务背景', async () => {
    await applyIndustryTemplate(env.DB, 'fertility')
    const svc = await env.DB.prepare("SELECT COUNT(*) AS n FROM services WHERE id LIKE 'svc-00%'").first<{ n: number }>()
    expect(svc?.n).toBe(4)
    expect(await getIndustryContext(env.DB)).toContain('辅助生殖')
  })

  it('空白模板：清除行业示例，合作伙伴类型与 AI 提示词改为通用', async () => {
    await applyIndustryTemplate(env.DB, 'blank')
    const svc = await env.DB.prepare("SELECT COUNT(*) AS n FROM services WHERE id LIKE 'svc-00%'").first<{ n: number }>()
    expect(svc?.n).toBe(0)
    const pt = await env.DB.prepare("SELECT value FROM option_items WHERE group_key = 'partner_type' ORDER BY sort_order").all<{ value: string }>()
    expect(pt.results.map((r) => r.value)).toEqual(['Supplier', 'Agency', 'Channel'])
    const prompts = await env.DB.prepare("SELECT system_prompt, user_prompt_template FROM ai_prompts WHERE id LIKE 'builtin-%'").all<{ system_prompt: string; user_prompt_template: string }>()
    for (const p of prompts.results) {
      expect(p.system_prompt + p.user_prompt_template).not.toMatch(/辅助生殖|代孕|试管/)
      expect(p.user_prompt_template).toContain('{{activities}}')
    }
    expect(await getIndustryContext(env.DB)).toBe('')
    // 重复执行不报错（INSERT OR IGNORE / 幂等更新）
    await applyIndustryTemplate(env.DB, 'blank')
  })

  it('业务背景拼进 AI 系统提示词；未设置时不加', () => {
    expect(industryContextBlock('')).toBe('')
    expect(industryContextBlock('留学咨询')).toBe('\n\n业务背景：留学咨询')
  })
})

describe('初始化与设置接口', () => {
  it('初始化接口校验模板参数；已初始化时拒绝（不会再次应用模板）', async () => {
    await createUser('admin')
    const body = { name: 'x', email: 'setup@test.local', password: '12345678' }
    expect((await api(null, 'POST', '/api/public/setup', { ...body, template: 'unknown' })).status).toBe(400)
    expect((await api(null, 'POST', '/api/public/setup', { ...body, template: 'blank' })).status).toBe(403)
  })

  it('管理员可以在系统设置中修改业务背景', async () => {
    const admin = await createUser('admin')
    const res = await api(admin, 'PUT', '/api/admin/settings', { industry_context: '留学咨询机构' })
    expect(res.status).toBe(200)
    expect(await getIndustryContext(env.DB)).toBe('留学咨询机构')
  })
})
