// 字段值校验：界面、对外接口、AI 助手、MCP、工作流写入时共用，避免脏数据进库
// （日期格式不对会让「逾期 / 今天 / 本周」筛选失效；选项值不在配置里界面无法显示）
import { badRequest } from './errors'

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
// 日期，可带时间：YYYY-MM-DD[ T]HH:mm[:ss[.sss]][Z|±HH:mm]
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

function isRealDate(y: string, m: string, d: string): boolean {
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d)
}

/** 日期字段（如下次联系时间）：YYYY-MM-DD；null / undefined / 空字符串表示不修改或清除，不校验 */
export function assertDate(value: string | null | undefined, label: string): void {
  if (value === null || value === undefined || value === '') return
  const m = DATE_RE.exec(value)
  if (!m || !isRealDate(m[1]!, m[2]!, m[3]!)) throw badRequest(`${label}格式应为 YYYY-MM-DD：${value}`)
}

/** 日期时间字段（如跟进时间）：YYYY-MM-DD，可带 HH:mm[:ss] */
export function assertDateTime(value: string | null | undefined, label: string): void {
  if (value === null || value === undefined || value === '') return
  const m = DATETIME_RE.exec(value)
  if (!m || !isRealDate(m[1]!, m[2]!, m[3]!)) throw badRequest(`${label}格式应为 YYYY-MM-DD 或 YYYY-MM-DD HH:mm：${value}`)
}

/** 选项字段（合同状态、丢失原因等）：值必须是「选项配置」中启用的值；空值表示清除，不校验 */
export async function assertOptionValue(
  db: D1Database, groupKey: string, value: string | null | undefined, label: string,
): Promise<void> {
  if (value === null || value === undefined || value === '') return
  const row = await db.prepare('SELECT 1 AS ok FROM option_items WHERE group_key = ? AND value = ? AND is_active = 1')
    .bind(groupKey, value).first<{ ok: number }>()
  if (row) return
  const opts = await db.prepare('SELECT value FROM option_items WHERE group_key = ? AND is_active = 1 ORDER BY sort_order')
    .bind(groupKey).all<{ value: string }>()
  throw badRequest(`无效的${label}：${value}，可选值：${opts.results.map((o) => o.value).join(' / ') || '（未配置）'}`)
}
