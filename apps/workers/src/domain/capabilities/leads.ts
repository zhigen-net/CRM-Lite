// 线索相关能力
import * as leads from '../leads/service'
import { recentActivities } from '../activities/service'
import { badRequest } from '../errors'
import type { Capability } from './types'

const NEXT_CONTACT = { type: 'string', enum: ['overdue', 'today', 'week'], description: 'overdue=已逾期 today=今天到期 week=未来7天' } as const

export const queryLeads: Capability = {
  name: 'query_leads',
  description: '查询线索列表，支持搜索姓名/联系方式、按状态筛选、按下次联系时间筛选。返回匹配的线索列表及总数。',
  scope: 'leads:read',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      search:      { type: 'string', description: '搜索关键词（姓名、联系方式、来源、编号）' },
      status:      { type: 'string', description: '线索状态值，先用 get_options(lead_status) 获取可用值' },
      nextContact: NEXT_CONTACT,
      mine:        { type: 'boolean', description: '只查询分配给自己的线索' },
      pageSize:    { type: 'number', description: '返回条数，默认10，最多50' },
    },
  },
  async run({ db }, actor, input) {
    const result = await leads.listLeads(db, actor, {
      search: input.search as string | undefined,
      status: input.status as string | undefined,
      nextContact: input.nextContact as string | undefined,
      mine: input.mine as boolean | undefined,
      pageSize: Math.min(50, Number(input.pageSize ?? 10)),
    })
    // 只返回模型需要的字段，节省上下文
    return {
      total: result.total,
      leads: result.data.map((l) => ({
        id: l.id, leadNo: l.leadNo, name: l.name, contactInfo: l.contactInfo, status: l.status, source: l.source,
        nextContactDate: l.nextContactDate, intendedServices: l.intendedServices, assignedToName: l.assignedToName,
      })),
    }
  },
}

export const getLead: Capability = {
  name: 'get_lead',
  description: '获取单个线索的完整信息，包含基本资料和最近10条跟进记录。在对某条线索执行操作前先调用此工具了解现状。',
  scope: 'leads:read',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string', description: '线索ID' } },
    required: ['id'],
  },
  async run({ db }, actor, input) {
    const id = input.id as string
    const lead = await leads.getLead(db, actor, id)
    return { ...lead, recentActivities: await recentActivities(db, 'lead', id) }
  },
}

export const updateLead: Capability = {
  name: 'update_lead',
  description: '更新线索字段，包括状态、负责人、意向服务、备注、下次联系时间。重要：状态变更请同时用 create_activity 留下操作记录。',
  scope: 'leads:write',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: {
      id:               { type: 'string', description: '线索ID' },
      status:           { type: 'string', description: '新状态值，先用 get_options(lead_status) 确认可用值' },
      assignedToUserId: { type: ['string', 'null'], description: '负责人用户ID，传 null 取消分配' },
      intendedServices: { type: 'array', items: { type: 'string' }, description: '意向服务名称列表' },
      notes:            { type: 'string', description: '备注内容' },
      nextContactDate:  { type: 'string', description: '下次联系日期 YYYY-MM-DD' },
    },
    required: ['id'],
  },
  async run(deps, actor, input) {
    const patch: leads.UpdateLeadPatch = {}
    if (input.status !== undefined) patch.status = input.status as string
    if (input.notes !== undefined) patch.notes = input.notes as string | null
    if (input.assignedToUserId !== undefined) patch.assignedToUserId = input.assignedToUserId as string | null
    if (input.nextContactDate !== undefined) patch.nextContactDate = input.nextContactDate as string | null
    if (input.intendedServices !== undefined) patch.intendedServices = input.intendedServices as string[]
    if (Object.keys(patch).length === 0) throw badRequest('未提供任何要更新的字段')

    await leads.updateLead(deps, actor, input.id as string, patch)
    return { success: true, message: '线索已更新' }
  },
}
