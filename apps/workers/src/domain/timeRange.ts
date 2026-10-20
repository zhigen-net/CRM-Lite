// 统计用的日期范围：界面按「系统设置 → 时区」的自然日选择，数据库里的时间都是 UTC（YYYY-MM-DD HH:MM:SS）
// 这里把自然日范围换算成 UTC 起止时间，并给出按天分组用的时区偏移
import { badRequest } from './errors'

export interface DayRange {
  /** 起止日期（含），系统时区的自然日 YYYY-MM-DD */
  from: string
  to: string
  /** UTC 起止：startUtc <= t < endUtc */
  startUtc: string
  endUtc: string
  /** 上一个等长周期的 UTC 起止，用于环比 */
  prevStartUtc: string
  prevEndUtc: string
  /** 时区相对 UTC 的偏移（分钟），按天分组时用 date(t, '+N minutes')；范围内有夏令时切换时以起始日为准 */
  offsetMinutes: number
  days: string[]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const MAX_RANGE_DAYS = 366

export async function systemTimezone(db: D1Database): Promise<string> {
  const row = await db.prepare("SELECT value FROM system_settings WHERE key = 'timezone'").first<{ value: string }>()
  return row?.value || 'Asia/Shanghai'
}

/** 某一时刻该时区相对 UTC 的偏移（分钟） */
export function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at).map((p) => [p.type, p.value]))
  const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!)
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000)
}

/** 该时区的今天 YYYY-MM-DD */
export function todayIn(tz: string, now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: tz })
}

const toSql = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`)
const addDays = (d: string, n: number) => new Date(dayMs(d) + n * 86400000).toISOString().slice(0, 10)

/** 解析 from / to（YYYY-MM-DD，含首尾）；都不传时为最近 7 天 */
export function resolveRange(tz: string, from?: string | null, to?: string | null, now = new Date()): DayRange {
  const today = todayIn(tz, now)
  const end = to || today
  const start = from || addDays(end, -6)
  if (!DATE_RE.test(start) || !DATE_RE.test(end) || Number.isNaN(dayMs(start)) || Number.isNaN(dayMs(end))) {
    throw badRequest('日期格式应为 YYYY-MM-DD')
  }
  const span = Math.round((dayMs(end) - dayMs(start)) / 86400000) + 1
  if (span < 1) throw badRequest('开始日期不能晚于结束日期')
  if (span > MAX_RANGE_DAYS) throw badRequest(`时间范围不能超过 ${MAX_RANGE_DAYS} 天`)

  const offsetMinutes = tzOffsetMinutes(tz, new Date(dayMs(start) + 12 * 3600000))
  const startMs = dayMs(start) - offsetMinutes * 60000
  const endMs = dayMs(addDays(end, 1)) - offsetMinutes * 60000
  const len = endMs - startMs
  return {
    from: start, to: end,
    startUtc: toSql(startMs), endUtc: toSql(endMs),
    prevStartUtc: toSql(startMs - len), prevEndUtc: toSql(startMs),
    offsetMinutes,
    days: Array.from({ length: span }, (_, i) => addDays(start, i)),
  }
}

/** 按系统时区自然日分组的 SQL 表达式，如 date(l.created_at, '+480 minutes') */
export function localDateSql(column: string, range: DayRange): string {
  const m = range.offsetMinutes
  return `date(${column}, '${m >= 0 ? '+' : '-'}${Math.abs(m)} minutes')`
}
