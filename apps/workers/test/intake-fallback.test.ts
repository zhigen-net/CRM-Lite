// 未收录的意向服务兜底：优先用系统里已有的「其他 / Other」，不同部署的服务名可能是中文或英文
import { describe, expect, it } from 'vitest'
import { normalizeExternalLead, pickFallbackService } from '../src/domain/leads/intake'
import { buildLlmsTxt, buildOpenApi } from '../src/crm/routes/v1Docs'

// 只提供服务列表查询的假 D1，避免改动共享的测试数据库
const dbWithServices = (names: string[]) => ({
  prepare: () => ({ all: async () => ({ results: names.map((name) => ({ name })) }) }),
}) as unknown as D1Database

describe('pickFallbackService', () => {
  it('优先中文「其他」，其次「其它」、Other（不区分大小写）', () => {
    expect(pickFallbackService(['IVF', 'Other', '其他'])).toBe('其他')
    expect(pickFallbackService(['IVF', '其它'])).toBe('其它')
    expect(pickFallbackService(['IVF', 'Other'])).toBe('Other')
    expect(pickFallbackService(['IVF', 'OTHERS'])).toBe('OTHERS')
  })
  it('系统没有兜底服务时用「其他」', () => {
    expect(pickFallbackService(['IVF'])).toBe('其他')
    expect(pickFallbackService([])).toBe('其他')
  })
})

describe('外部线索整理使用实际存在的兜底服务', () => {
  it('英文服务名的部署：未收录的服务记为 Other，原值写入备注', async () => {
    const input = await normalizeExternalLead(dbWithServices(['IVF', 'Other']), {
      source: 'x', name: 'x', contactInfo: 'x', intendedServices: ['IVF', '火星旅行', 'Mars'],
    })
    expect(input.intendedServices).toEqual(['IVF', 'Other'])
    expect(input.notes).toContain('火星旅行、Mars')
  })
  it('意向服务选填：没传时为空，不自动记为兜底服务', async () => {
    const input = await normalizeExternalLead(dbWithServices(['IVF', 'Other']), { source: 'x', name: 'x', contactInfo: 'x' })
    expect(input.intendedServices).toEqual([])
  })
  it('接口说明写明实际的兜底服务', () => {
    expect(buildLlmsTxt('https://crm.example', ['IVF', 'Other'])).toContain('不在列表中的值会被记为「Other」')
    const doc = buildOpenApi('https://crm.example', ['IVF', 'Other'])
    expect(doc.components.schemas.LeadInput.properties.intendedServices.description).toContain('记为「Other」')
  })
  it('访客统计脚本加的 crm_vid 字段不写入备注', async () => {
    const input = await normalizeExternalLead(dbWithServices(['IVF']), {
      source: 'x', name: 'x', contactInfo: 'x', intendedServices: ['IVF'], crm_vid: 'b1c2', pageTitle: '落地页',
    })
    expect(input.notes).toBe('附加信息：pageTitle：落地页')
  })
})
