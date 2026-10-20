// 外部提交线索的整理规则（由 submit.ts 统一调用：对外接口、网站表单、AI 能力、失败补录）
import type { CreateLeadInput } from './service'
import { parseVisitorId } from '../tracking/link'

const KNOWN_FIELDS = new Set(['source', 'name', 'contactInfo', 'intendedServices', 'notes', 'adInfo'])
// 访客统计脚本自动加到表单里的访客 ID：用于关联访客来源与轨迹，不写入备注
const IGNORED_FIELDS = new Set(['crm_vid', 'visitorId'])

// 顶层广告字段别名（兼容旧格式，统一映射为中文 key）
const AD_FIELD_ALIASES: Record<string, string> = {
  ip: 'ip', url: 'url',
  account: '账户', '账户': '账户',
  campaign: '广告计划', '广告计划': '广告计划',
  adGroup: '广告组', '广告组': '广告组', ad_group: '广告组',
  ad: '广告', '广告': '广告',
}

// 网站表单常见的字段名：没有标准字段时按顺序取第一个有值的
const NAME_ALIASES = ['name', 'fullname', 'full_name', 'username', '姓名', '称呼', '名字']
const CONTACT_ALIASES = ['contactInfo', 'contact_info', 'contact', 'phone', 'mobile', 'tel', 'telephone', 'wechat', 'weixin', 'email',
  '联系方式', '手机', '手机号', '电话', '微信', '邮箱']
const NOTES_ALIASES = ['notes', 'message', 'remark', 'comment', 'content', '留言', '备注', '咨询内容']

const filled = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== ''
/** 按别名顺序取第一个有值的字段，返回字段名和值 */
function pick(body: Record<string, unknown>, aliases: string[]): [string, string] | null {
  for (const k of aliases) if (filled(body[k])) return [k, String(body[k]).trim()]
  return null
}

// 兜底服务的常见叫法；不同部署的服务名可能是中文或英文
const FALLBACK_SERVICE_ALIASES = ['其他', '其它', 'other', 'others']

/** 未收录的意向服务改记为哪个服务：优先用系统里已有的「其他 / Other」，都没有时用「其他」 */
export function pickFallbackService(serviceNames: string[]): string {
  for (const alias of FALLBACK_SERVICE_ALIASES) {
    const hit = serviceNames.find((n) => n.trim().toLowerCase() === alias)
    if (hit) return hit
  }
  return '其他'
}

/** 外部接口可用的意向服务名（未删除的服务，按名称排序） */
export async function listIntakeServiceNames(db: D1Database): Promise<string[]> {
  const rows = await db.prepare('SELECT name FROM services WHERE deleted_at IS NULL ORDER BY name').all<{ name: string }>()
  return rows.results.map((r) => r.name)
}

/**
 * 把外部推送的原始请求体整理成新建线索的参数：
 * - 意向服务选填；系统未收录的意向服务替换为兜底服务（「其他」或 Other），原值写入备注
 * - 广告字段优先取 adInfo 对象，再合并顶层别名字段
 * - 其余未知字段拼到备注，不丢信息
 */
export async function normalizeExternalLead(db: D1Database, body: Record<string, unknown>): Promise<CreateLeadInput> {
  const serviceNames = await listIntakeServiceNames(db)
  const validServices = new Set(serviceNames)
  const fallback = pickFallbackService(serviceNames)

  const namePick = pick(body, NAME_ALIASES)
  const contactPick = pick(body, CONTACT_ALIASES)
  const used = new Set([namePick?.[0], contactPick?.[0]].filter(Boolean) as string[])
  const notes: string[] = []
  for (const k of NOTES_ALIASES) {
    if (filled(body[k])) { notes.push(String(body[k]).trim()); used.add(k) }
  }

  // 意向服务选填：没传时为空；传了系统未收录的值时记为兜底服务
  const submitted = Array.isArray(body.intendedServices) ? (body.intendedServices as unknown[]).map(String) : []
  // 兜底服务本身（例如系统里没有配置「其他」时的「其他」）不算未收录，避免备注里出现无意义的提示
  const unknown = submitted.filter((s) => !validServices.has(s) && s !== fallback)
  if (unknown.length > 0) notes.push(`意向服务（系统未收录）：${unknown.join('、')}`)
  const intendedServices = [...new Set(submitted.map((s) => validServices.has(s) ? s : fallback))]

  const adInfo: Record<string, string> = {}
  if (body.adInfo && typeof body.adInfo === 'object') {
    for (const [k, v] of Object.entries(body.adInfo as Record<string, unknown>)) {
      if (v !== undefined && v !== null && v !== '') adInfo[k] = String(v)
    }
  }
  const extra: string[] = []
  for (const [k, v] of Object.entries(body)) {
    if (KNOWN_FIELDS.has(k) || IGNORED_FIELDS.has(k) || used.has(k) || k === 'contact_info' || !filled(v)) continue
    const adKey = AD_FIELD_ALIASES[k]
    if (adKey) {
      if (!adInfo[adKey]) adInfo[adKey] = String(v)
    } else {
      extra.push(`${k}：${v}`)
    }
  }
  if (extra.length > 0) notes.push(`附加信息：${extra.join('；')}`)

  return {
    source: String(body.source ?? '').trim(),
    name: namePick?.[1] ?? '',
    contactInfo: contactPick?.[1] ?? '',
    intendedServices,
    notes: notes.length > 0 ? notes.join('\n') : null,
    adInfo: Object.keys(adInfo).length > 0 ? adInfo : null,
    visitorId: parseVisitorId(body.crm_vid) ?? parseVisitorId(body.visitorId),
  }
}
