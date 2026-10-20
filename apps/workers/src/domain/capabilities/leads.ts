// 线索相关能力
import * as leads from '../leads/service'
import { recentActivities } from '../activities/service'
import { badRequest } from '../errors'
import { submitExternalLead } from '../leads/submit'
import type { Capability } from './types'
import { visitorSourceSummary } from '../tracking/attribution'

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
  description: '获取单个线索的完整信息，包含基本资料、最近10条跟进记录，以及网站访客来源（visitorSource：渠道、广告参数、落地页、访问次数，未关联访客时为 null）。在对某条线索执行操作前先调用此工具了解现状。',
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
    return { ...lead, recentActivities: await recentActivities(db, 'lead', id), visitorSource: await visitorSourceSummary(db, actor, lead.visitorId) }
  },
}

export const updateLead: Capability = {
  name: 'update_lead',
  description: '更新线索字段：状态、丢失原因、来源、联系方式、负责人、所属团队、意向服务、备注、下次联系时间。只传需要修改的字段。状态改为 Lost 时请同时填写 lostReason；重要变更请同时用 create_activity 留下操作记录。',
  scope: 'leads:write',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: {
      id:               { type: 'string', description: '线索ID' },
      status:           { type: 'string', description: '新状态值，先用 get_options(lead_status) 确认可用值' },
      lostReason:       { type: ['string', 'null'], description: '丢失原因，先用 get_options(lost_reason) 确认可用值' },
      source:           { type: 'string', description: '线索来源' },
      contactInfo:      { type: 'string', description: '联系方式（电话、微信或邮箱）' },
      assignedToUserId: { type: ['string', 'null'], description: '负责人用户ID（用 query_users 查询），传 null 取消分配' },
      assignedToTeamId: { type: ['string', 'null'], description: '所属团队ID（用 query_teams 查询），仅管理员可修改' },
      intendedServices: { type: 'array', items: { type: 'string' }, description: '意向服务名称列表' },
      notes:            { type: 'string', description: '备注内容' },
      nextContactDate:  { type: 'string', description: '下次联系日期 YYYY-MM-DD' },
    },
    required: ['id'],
  },
  async run(deps, actor, input) {
    const patch: leads.UpdateLeadPatch = {}
    if (input.status !== undefined) patch.status = input.status as string
    if (input.lostReason !== undefined) patch.lostReason = input.lostReason as string | null
    if (input.source !== undefined) patch.source = input.source as string
    if (input.contactInfo !== undefined) patch.contactInfo = input.contactInfo as string
    if (input.assignedToTeamId !== undefined) patch.assignedToTeamId = input.assignedToTeamId as string | null
    if (input.notes !== undefined) patch.notes = input.notes as string | null
    if (input.assignedToUserId !== undefined) patch.assignedToUserId = input.assignedToUserId as string | null
    if (input.nextContactDate !== undefined) patch.nextContactDate = input.nextContactDate as string | null
    if (input.intendedServices !== undefined) patch.intendedServices = input.intendedServices as string[]
    if (Object.keys(patch).length === 0) throw badRequest('未提供任何要更新的字段')

    await leads.updateLead(deps, actor, input.id as string, patch)
    return { success: true, message: '线索已更新' }
  },
}

export const createLead: Capability = {
  name: 'create_lead',
  description: '新建线索。新线索会按系统的分配规则自动分配负责人，并触发「新建线索」工作流。意向服务不在系统列表中时会记为「其他」，原值写入备注。新建前建议先用 query_leads 按联系方式查重。',
  scope: 'leads:create',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: {
      source:           { type: 'string', description: '线索来源，如「转介绍」「电话咨询」' },
      name:             { type: 'string', description: '客户姓名或称呼' },
      contactInfo:      { type: 'string', description: '电话、微信或邮箱' },
      intendedServices: { type: 'array', items: { type: 'string' }, description: '意向服务名称列表，可用值见 llms.txt 或界面「服务管理」' },
      notes:            { type: 'string', description: '备注' },
    },
    required: ['source', 'name', 'contactInfo'],
  },
  async run(deps, actor, input) {
    // 与对外接口、网站表单同一套处理；审计由能力注册表统一记录
    const result = await submitExternalLead(deps, actor, input, { linkCreatorTeam: true })
    return { success: true, leadId: result.id, intendedServices: result.lead.intendedServices, message: '线索已创建' }
  },
}
