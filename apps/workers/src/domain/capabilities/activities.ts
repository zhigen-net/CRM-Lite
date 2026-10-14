// 跟进记录相关能力
import * as activities from '../activities/service'
import type { Capability } from './types'

export const createActivity: Capability = {
  name: 'create_activity',
  description: '为线索或客户创建跟进记录。这是执行跟进、备注、安排下次联系的主要方式，所有动作都通过跟进记录留痕。',
  scope: 'activities:write',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: {
      entityType:      { type: 'string', enum: ['lead', 'client'], description: '实体类型' },
      entityId:        { type: 'string', description: '线索或客户的ID' },
      activityType:    { type: 'string', description: '跟进类型值（如 Call、Meeting、Email、Note、System），先用 get_options(activity_type) 确认可用值' },
      description:     { type: 'string', description: '跟进内容描述' },
      nextContactDate: { type: 'string', description: '下次联系日期，格式 YYYY-MM-DD，可选' },
    },
    required: ['entityType', 'entityId', 'activityType', 'description'],
  },
  async run(deps, actor, input) {
    const entityType = input.entityType as 'lead' | 'client'
    const entityId = input.entityId as string
    const id = await activities.createActivity(deps, actor, {
      leadId: entityType === 'lead' ? entityId : null,
      clientId: entityType === 'client' ? entityId : null,
      activityType: input.activityType as string,
      description: (input.description as string | undefined) ?? null,
      activityDate: new Date().toISOString().replace('T', ' ').slice(0, 19),
      nextContactDate: (input.nextContactDate as string | undefined) ?? null,
    })
    return { success: true, activityId: id, message: '跟进记录已创建' }
  },
}
