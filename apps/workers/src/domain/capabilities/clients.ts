// 客户相关能力
import * as clients from '../clients/service'
import { recentActivities } from '../activities/service'
import { badRequest } from '../errors'
import type { Capability } from './types'

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
  description: '获取单个客户的完整信息，包含基本资料和最近10条跟进记录。在对某个客户执行操作前先调用此工具了解现状。',
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
    return { ...client, recentActivities: await recentActivities(db, 'client', id) }
  },
}

export const updateClient: Capability = {
  name: 'update_client',
  description: '更新客户字段，包括合同状态、服务套餐、联系方式、下次联系时间。重要：重要变更请同时用 create_activity 留下操作记录。',
  scope: 'clients:write',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: {
      id:              { type: 'string', description: '客户ID' },
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
