// 能力注册表的类型：每个能力只定义一次，AI 助手工具、MCP 工具、对外说明都从注册表生成
import type { Actor, Deps } from '../actor'

/** 能力所需的权限范围；API Key / OAuth 授权时按 scope 限制可调用的能力 */
export const SCOPES = [
  'leads:read', 'leads:create', 'leads:write',
  'clients:read', 'clients:write',
  'activities:read', 'activities:write',
  'meta:read',
] as const
export type Scope = typeof SCOPES[number]

/** 能力输入的 JSON Schema（只用到顶层对象的常见关键字） */
export interface PropertySchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | ('string' | 'null')[]
  description?: string
  enum?: readonly string[]
  items?: { type: 'string' }
}
export interface InputSchema {
  type: 'object'
  properties: Record<string, PropertySchema>
  required?: string[]
}

export type CapabilityInput = Record<string, unknown>

export interface Capability {
  /** 工具名（snake_case），各入口保持一致 */
  name: string
  description: string
  inputSchema: InputSchema
  scope: Scope
  /** 只读能力不修改任何数据（MCP 的 readOnlyHint） */
  readOnly: boolean
  run(deps: Deps, actor: Actor, input: CapabilityInput): Promise<unknown>
}
