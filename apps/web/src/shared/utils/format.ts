import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'

let _timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

export function setAppTimezone(tz: string) {
  _timezone = tz
}

// SQLite CURRENT_TIMESTAMP 返回 "YYYY-MM-DD HH:MM:SS"（UTC，无时区标记）
// 浏览器 new Date() 会把无标记字符串当本地时间解析，需手动补 Z
function toDate(date: string | Date): Date {
  if (date instanceof Date) return date
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(date)) {
    return new Date(date.replace(' ', 'T') + 'Z')
  }
  return new Date(date)
}

const isValid = (d: Date) => !Number.isNaN(d.getTime())

/** 格式化日期时间；无法解析的值（历史脏数据等）原样显示，不让整个页面崩溃 */
export function formatDate(date: string | Date) {
  const d = toDate(date)
  if (!isValid(d)) return String(date)
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: _timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d).replace(/\//g, '-')
}

export function formatRelativeTime(date: string | Date) {
  const d = toDate(date)
  if (!isValid(d)) return String(date)
  return formatDistanceToNow(d, { locale: zhCN, addSuffix: true })
}

// 返回当前时间在 app 时区下的 datetime-local 输入值（yyyy-MM-ddTHH:mm）
export function nowForInput() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: _timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date()).replace(' ', 'T')
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** app 时区（系统设置）下的今天 YYYY-MM-DD */
export function todayInApp(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: _timezone })
}
