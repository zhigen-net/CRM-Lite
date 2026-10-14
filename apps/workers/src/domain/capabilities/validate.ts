// 按能力的 InputSchema 校验并整理输入：缺少必填、类型不符、不在枚举内时抛 400；
// 未声明的字段直接丢弃；模型常把数字、布尔写成字符串，这里做宽松转换
import { badRequest } from '../errors'
import type { CapabilityInput, InputSchema, PropertySchema } from './types'

function coerce(key: string, value: unknown, schema: PropertySchema): unknown {
  const types: string[] = Array.isArray(schema.type) ? schema.type : [schema.type]
  if (value === null) {
    if (types.includes('null')) return null
    throw badRequest(`参数 ${key} 不能为 null`)
  }
  if (types.includes('number')) {
    const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
    if (typeof n === 'number' && Number.isFinite(n)) return n
    throw badRequest(`参数 ${key} 应为数字`)
  }
  if (types.includes('boolean')) {
    if (typeof value === 'boolean') return value
    if (value === 'true' || value === 'false') return value === 'true'
    throw badRequest(`参数 ${key} 应为布尔值`)
  }
  if (types.includes('array')) {
    if (!Array.isArray(value)) throw badRequest(`参数 ${key} 应为数组`)
    return value.map(String)
  }
  if (types.includes('object')) {
    if (typeof value !== 'object' || Array.isArray(value)) throw badRequest(`参数 ${key} 应为对象`)
    return value
  }
  if (typeof value !== 'string') throw badRequest(`参数 ${key} 应为字符串`)
  if (schema.enum && !schema.enum.includes(value)) {
    throw badRequest(`参数 ${key} 的取值应为：${schema.enum.join(' / ')}`)
  }
  return value
}

export function validateInput(schema: InputSchema, input: unknown): CapabilityInput {
  const raw = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as CapabilityInput
  const out: CapabilityInput = {}
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (raw[key] === undefined) continue
    out[key] = coerce(key, raw[key], prop)
  }
  for (const key of schema.required ?? []) {
    if (out[key] === undefined || out[key] === '') throw badRequest(`缺少必填参数 ${key}`)
  }
  return out
}
