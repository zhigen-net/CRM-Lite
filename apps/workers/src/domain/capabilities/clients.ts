// 客户相关能力
import * as clients from '../clients/service'
import { recentActivities } from '../activities/service'
import { badRequest } from '../errors'
import { getLead } from '../leads/service'
import type { Capability } from './types'
import { leadVisitorId, visitorSourceSummary } from '../tracking/attribution'

export const queryClients: Capability = {
  name: 'query_clients',
  description: '查询客户列表，支持搜索姓名/电话/邮箱、按合同状态筛选、按下次联系时间筛选。',
  scope: 'clients:read',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      search:         { type: 'string', description: '搜索关键词（姓名、电话、邮箱）' },
      contractStatus: { type: 'string', description: '合同状态值，先用 get_options(contract_status) 获取可用值' },
      nextContact:    { type: 'string', enum: ['overdue', 'today', 'week'], description: 'overdue=已逾期 today=今天到期 week=未来7天' },
      pageSize:       { type: 'number', description: '返回条数，默认10，最多50' },
    },
  },
  async run({ db }, actor, input) {
    const result = await clients.listClients(db, actor, {
      search: input.search as string | undefined,
      contractStatus: input.contractStatus as string | undefined,
      nextContact: input.nextContact as string | undefined,
      pageSize: Math.min(50, Number(input.pageSize ?? 10)),
    })
    // 只返回模型需要的字段，节省上下文
    return {
      total: result.total,
      clients: result.data.map((c) => ({
        id: c.id, name: c.name, phone: c.phone, email: c.email, contractStatus: c.contractStatus,
        servicePlans: c.servicePlans, nextContactDate: c.nextContactDate, assignedSalesName: c.assignedSalesName,
      })),
    }
  },
}

export const getClient: Capability = {
  name: 'get_client',
  description: '获取单个客户的完整信息，包含基本资料、最近10条跟进记录，以及转化前线索的网站访客来源（visitorSource，未关联时为 null）。在对某个客户执行操作前先调用此工具了解现状。',
  scope: 'clients:read',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string', description: '客户ID' } },
    required: ['id'],
  },
  async run({ db }, actor, input) {
    const id = input.id as string
    const client = await clients.getClient(db, actor, id)
    return { ...client, recentActivities: await recentActivities(db, 'client', id), visitorSource: await visitorSourceSummary(db, await leadVisitorId(db, client.leadId)) }
  },
}

export const updateClient: Capability = {
  name: 'update_client',
  description: '更新客户字段：姓名、电话、邮箱、合同状态、服务套餐、负责销售、客户备注、下次联系时间。只传需要修改的字段。重要变更请同时用 create_activity 留下操作记录。',
  scope: 'clients:write',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: {
      id:              { type: 'string', description: '客户ID' },
      name:            { type: 'string', description: '客户姓名' },
      assignedSalesUserId: { type: ['string', 'null'], description: '负责销售的用户ID（用 query_users 查询），传 null 取消' },
      notes:           { type: ['string', 'null'], description: '客户备注（客户详情页显示的备注，会覆盖原备注）' },
      contractStatus:  { type: 'string', description: '合同状态值，先用 get_options(contract_status) 确认可用值' },
      servicePlans:    { type: 'array', items: { type: 'string' }, description: '服务套餐名称列表' },
      phone:           { type: 'string', description: '联系电话' },
      email:           { type: 'string', description: '邮箱地址' },
      nextContactDate: { type: 'string', description: '下次联系日期 YYYY-MM-DD' },
    },
    required: ['id'],
  },
  async run(deps, actor, input) {
    const patch: clients.UpdateClientPatch = {}
    if (input.name !== undefined) patch.name = input.name as string
    if (input.assignedSalesUserId !== undefined) patch.assignedSalesUserId = input.assignedSalesUserId as string | null
    if (input.notes !== undefined) {
      // 备注存在 detailedProfile 里：在原资料上合并，不丢失来源等其它字段
      const current = await clients.getClient(deps.db, actor, input.id as string)
      const profile = (current.detailedProfile ?? {}) as Record<string, unknown>
      patch.detailedProfile = { ...profile, notes: input.notes }
    }
    if (input.contractStatus !== undefined) patch.contractStatus = input.contractStatus as string | null
    if (input.phone !== undefined) patch.phone = input.phone as string | null
    if (input.email !== undefined) patch.email = input.email as string | null
    if (input.nextContactDate !== undefined) patch.nextContactDate = input.nextContactDate as string | null
    if (input.servicePlans !== undefined) patch.servicePlans = input.servicePlans as string[]
    if (Object.keys(patch).length === 0) throw badRequest('未提供任何要更新的字段')

    await clients.updateClient(deps, actor, input.id as string, patch)
    return { success: true, message: '客户已更新' }
  },
}

export const convertLead: Capability = {
  name: 'convert_lead',
  description: '把线索转化为客户（与界面「转化为客户」相同）：线索状态变为 Converted，跟进记录迁移到新客户，并触发相关工作流。已转化的线索不能重复转化。姓名、电话默认取线索的信息。',
  scope: 'clients:write',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: {
      leadId:              { type: 'string', description: '要转化的线索ID' },
      name:                { type: 'string', description: '客户姓名，默认取线索姓名' },
      phone:               { type: 'string', description: '联系电话，默认取线索联系方式' },
      email:               { type: 'string', description: '邮箱' },
      servicePlans:        { type: 'array', items: { type: 'string' }, description: '服务套餐名称列表' },
      assignedSalesUserId: { type: 'string', description: '负责销售的用户ID，默认取线索负责人' },
    },
    required: ['leadId'],
  },
  async run(deps, actor, input) {
    const lead = await getLead(deps.db, actor, input.leadId as string)
    const id = await clients.createClient(deps, actor, {
      leadId: input.leadId as string,
      name: (input.name as string | undefined) ?? String(lead.name ?? ''),
      phone: (input.phone as string | undefined) ?? (lead.contactInfo as string | null) ?? null,
      email: (input.email as string | undefined) ?? null,
      servicePlans: (input.servicePlans as string[] | undefined) ?? [],
      assignedSalesUserId: (input.assignedSalesUserId as string | undefined) ?? (lead.assignedToUserId as string | null) ?? null,
    })
    return { success: true, clientId: id, message: '线索已转化为客户' }
  },
}
