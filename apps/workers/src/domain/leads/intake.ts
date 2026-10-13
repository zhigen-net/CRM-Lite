// 外部推送线索的整理规则（对外接口 /api/v1/leads 与失败补录共用）
import type { CreateLeadInput } from './service'

const KNOWN_FIELDS = new Set(['source', 'name', 'contactInfo', 'intendedServices', 'notes', 'adInfo'])

// 顶层广告字段别名（兼容旧格式，统一映射为中文 key）
const AD_FIELD_ALIASES: Record<string, string> = {
  ip: 'ip', url: 'url',
  account: '账户', '账户': '账户',
  campaign: '广告计划', '广告计划': '广告计划',
  adGroup: '广告组', '广告组': '广告组', ad_group: '广告组',
  ad: '广告', '广告': '广告',
}

/**
 * 把外部推送的原始请求体整理成新建线索的参数：
 * - 系统未收录的意向服务替换为「其他」，原值写入备注
 * - 广告字段优先取 adInfo 对象，再合并顶层别名字段
 * - 其余未知字段拼到备注，不丢信息
 */
export async function normalizeExternalLead(db: D1Database, body: Record<string, unknown>): Promise<CreateLeadInput> {
  const serviceRows = await db.prepare('SELECT name FROM services WHERE deleted_at IS NULL').all<{ name: string }>()
  const validServices = new Set(serviceRows.results.map((r) => r.name))

  const notes: string[] = []
  if (body.notes) notes.push(String(body.notes))

  const submitted = Array.isArray(body.intendedServices) && body.intendedServices.length > 0
    ? (body.intendedServices as unknown[]).map(String)
    : ['其他']
  const unknown = submitted.filter((s) => !validServices.has(s))
  if (unknown.length > 0) notes.push(`意向服务（系统未收录）：${unknown.join('、')}`)
  const intendedServices = [...new Set(submitted.map((s) => validServices.has(s) ? s : '其他'))]

  const adInfo: Record<string, string> = {}
  if (body.adInfo && typeof body.adInfo === 'object') {
    for (const [k, v] of Object.entries(body.adInfo as Record<string, unknown>)) {
      if (v !== undefined && v !== null && v !== '') adInfo[k] = String(v)
    }
  }
  const extra: string[] = []
  for (const [k, v] of Object.entries(body)) {
    if (KNOWN_FIELDS.has(k) || k === 'contact_info') continue
    const adKey = AD_FIELD_ALIASES[k]
    if (adKey) {
      if (!adInfo[adKey]) adInfo[adKey] = String(v)
    } else {
      extra.push(`${k}：${v}`)
    }
  }
  if (extra.length > 0) notes.push(`附加信息：${extra.join('；')}`)

  return {
    source: String(body.source ?? ''),
    name: String(body.name ?? ''),
    contactInfo: String(body.contactInfo ?? body.contact_info ?? ''),
    intendedServices,
    notes: notes.length > 0 ? notes.join('\n') : null,
    adInfo: Object.keys(adInfo).length > 0 ? adInfo : null,
  }
}
