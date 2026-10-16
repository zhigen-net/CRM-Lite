// 联系方式打码：手机号、邮箱属于个人敏感信息，
// 通过 API Key / MCP 读取时，没有 contacts:read 权限就只返回打码后的值
const CONTACT_KEYS = new Set(['contactInfo', 'contact_info', 'phone', 'email'])

export function maskContact(value: string): string {
  const v = value.trim()
  const at = v.indexOf('@')
  if (at > 0) return `${v.slice(0, 1)}***${v.slice(at)}`
  const digits = v.replace(/\D/g, '')
  if (digits.length >= 7) return `${digits.slice(0, 3)}****${digits.slice(-4)}`
  if (v.length <= 2) return '*'.repeat(v.length)
  return `${v.slice(0, 1)}${'*'.repeat(Math.min(6, v.length - 2))}${v.slice(-1)}`
}

/** 深度遍历结果，对联系方式字段打码（不修改原对象） */
export function redactContacts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactContacts)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = CONTACT_KEYS.has(k) && typeof v === 'string' && v ? maskContact(v) : redactContacts(v)
    }
    return out
  }
  return value
}
