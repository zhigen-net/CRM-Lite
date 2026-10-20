// 外部提交线索的统一处理：对外接口 /api/v1/leads、网站表单 /api/t/lead、MCP / AI 助手 create_lead、失败补录都走这里
// 校验 → 整理（意向服务兜底、广告字段、未知字段进备注、访客关联）→ 新建（分配、工作流）→ 审计 / 失败记录
// 各入口只负责鉴权和响应格式，不要在入口里另写规则，避免几条路径的数据不一致
import type { Actor, Deps } from '../actor'
import { recordAudit } from '../audit'
import { badRequest } from '../errors'
import { normalizeExternalLead } from './intake'
import { createLead, type CreateLeadInput } from './service'

export interface SubmitOptions {
  /** 没有 source 时使用的来源（网站表单默认用站点名称） */
  defaultSource?: string | undefined
  /** 记审计日志（MCP / AI 助手由能力注册表统一记录，这里不重复） */
  audit?: boolean | undefined
  /** 失败时写入「失败记录」，供管理员补录 */
  failure?: { apiKeyPrefix?: string | null | undefined; siteId?: string | null | undefined } | undefined
  /** 预关联创建人所属团队（AI 助手新建时使用，与界面新建一致） */
  linkCreatorTeam?: boolean | undefined
  /** 由入口补充、但调用方没传时才使用的广告信息（如网站转发带来的访客 IP） */
  adInfoDefaults?: Record<string, string> | undefined
}


const text = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

/** 必填字段与类型校验；字段别名（如 phone → contactInfo）在 normalizeExternalLead 里统一处理 */
function validate(body: Record<string, unknown>) {
  if (body.intendedServices !== undefined && body.intendedServices !== null
    && !(Array.isArray(body.intendedServices) && body.intendedServices.every((s) => typeof s === 'string'))) {
    throw badRequest('intendedServices 必须是字符串数组')
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') throw badRequest('notes 必须是字符串')
  if (body.adInfo !== undefined && body.adInfo !== null && (typeof body.adInfo !== 'object' || Array.isArray(body.adInfo))) {
    throw badRequest('adInfo 必须是对象')
  }
}

/** 校验并整理（试运行也用这一步）：返回将要写入的线索参数 */
export async function prepareExternalLead(
  db: D1Database, raw: Record<string, unknown>, opts: Pick<SubmitOptions, 'defaultSource' | 'adInfoDefaults'> = {},
): Promise<CreateLeadInput> {
  validate(raw)
  const body = !text(raw.source) && opts.defaultSource ? { ...raw, source: opts.defaultSource } : raw
  const lead = await normalizeExternalLead(db, body)
  if (!lead.source.trim()) throw badRequest('请填写来源（source）')
  if (!lead.name.trim()) throw badRequest('请填写姓名（name）')
  if (!lead.contactInfo.trim()) throw badRequest('请填写联系方式（contactInfo）')
  if (opts.adInfoDefaults) {
    const merged = { ...opts.adInfoDefaults, ...(lead.adInfo ?? {}) }
    lead.adInfo = Object.keys(merged).length > 0 ? merged : null
  }
  return lead
}

/** 校验、整理并新建线索；参数错误直接抛出（不记失败），新建过程中的错误按选项记审计和失败 */
export async function submitExternalLead(
  deps: Deps, actor: Actor, raw: Record<string, unknown>, opts: SubmitOptions = {},
): Promise<{ id: string; lead: CreateLeadInput }> {
  const lead = await prepareExternalLead(deps.db, raw, opts)
  try {
    const id = await createLead(deps, actor, { ...lead, linkCreatorTeam: opts.linkCreatorTeam })
    if (opts.audit) recordAudit(deps, actor, { action: 'create_lead', status: 'ok', targetType: 'lead', targetId: id, input: raw })
    return { id, lead }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (opts.audit) recordAudit(deps, actor, { action: 'create_lead', status: 'error', input: raw, error: message })
    if (opts.failure) {
      // 后台保存失败记录，不阻塞响应，也不抛出新错误
      deps.waitUntil(deps.db.prepare(
        'INSERT INTO api_lead_failures (id, request_body, error_message, api_key_prefix, site_id) VALUES (?, ?, ?, ?, ?)',
      ).bind(crypto.randomUUID(), JSON.stringify(raw), message, opts.failure.apiKeyPrefix ?? null, opts.failure.siteId ?? null)
        .run().then(() => undefined).catch(() => undefined))
    }
    throw err
  }
}
