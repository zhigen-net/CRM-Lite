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

export const listActivities: Capability = {
  name: 'list_activities',
  description: '查询跟进记录，可按线索、客户、跟进类型、下次联系时间筛选，按创建时间倒序。查看单个线索/客户的最近记录也可用 get_lead / get_client。',
  scope: 'activities:read',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      leadId:       { type: 'string', description: '只看此线索的记录' },
      clientId:     { type: 'string', description: '只看此客户的记录' },
      activityType: { type: 'string', description: '跟进类型值，先用 get_options(activity_type) 获取' },
      nextContact:  { type: 'string', enum: ['overdue', 'today', 'week'], description: '按下次联系时间：overdue=已逾期 today=今天 week=未来7天' },
      search:       { type: 'string', description: '搜索内容、跟进人、线索或客户姓名' },
      pageSize:     { type: 'number', description: '返回条数，默认20，最多50' },
    },
  },
  async run({ db }, actor, input) {
    const result = await activities.listActivities(db, actor, {
      leadId: input.leadId as string | undefined,
      clientId: input.clientId as string | undefined,
      activityType: input.activityType as string | undefined,
      nextContact: input.nextContact as string | undefined,
      search: input.search as string | undefined,
      pageSize: Math.min(50, Number(input.pageSize ?? 20)),
    })
    return {
      total: result.total,
      activities: result.data.map((a) => ({
        id: a.id, activityType: a.activityType, description: a.description, activityDate: a.activityDate,
        nextContactDate: a.nextContactDate, userName: a.userName, leadId: a.leadId, leadName: a.leadName,
        clientId: a.clientId, clientName: a.clientName,
      })),
    }
  },
}
