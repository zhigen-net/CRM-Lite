// AI 助手的工具定义：由能力注册表生成（domain/capabilities），不要在这里单独定义工具
import { CAPABILITIES } from '../../domain/capabilities'

export interface ToolDef {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export const CRM_TOOLS: ToolDef[] = CAPABILITIES.map((c) => ({
  name: c.name,
  description: c.description,
  input_schema: c.inputSchema,
}))
