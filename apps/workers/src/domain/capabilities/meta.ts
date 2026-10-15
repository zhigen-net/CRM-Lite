// 辅助查询能力：枚举选项、可分配用户（只读，不涉及业务数据）
import type { Capability } from './types'

export const getOptions: Capability = {
  name: 'get_options',
  description: '获取系统中配置的枚举选项值。在执行状态变更等操作前必须先调用此工具确认有效值，避免传入无效值导致操作失败。',
  scope: 'meta:read',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      groupKey: {
        type: 'string',
        enum: ['lead_status', 'activity_type', 'contract_status', 'lost_reason'],
        description: '选项组：lead_status=线索状态 activity_type=跟进类型 contract_status=合同状态 lost_reason=丢失原因',
      },
    },
    required: ['groupKey'],
  },
  async run({ db }, _actor, input) {
    const groupKey = input.groupKey as string
    const rows = await db.prepare(
      'SELECT value, label FROM option_items WHERE group_key = ? AND is_active = 1 ORDER BY sort_order ASC',
    ).bind(groupKey).all<{ value: string; label: string }>()
    return { groupKey, options: rows.results }
  },
}

export const queryUsers: Capability = {
  name: 'query_users',
  description: '查询系统用户列表，获取可分配的用户ID和姓名。在分配负责人前调用此工具确认用户ID。',
  scope: 'meta:read',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      role: { type: 'string', enum: ['sales', 'operations', 'admin'], description: '按角色筛选，不传则返回全部活跃用户' },
    },
  },
  async run({ db }, _actor, input) {
    const role = input.role as string | undefined
    let sql = 'SELECT id, name, role FROM users WHERE is_active = 1'
    const params: unknown[] = []
    if (role) { sql += ' AND role = ?'; params.push(role) }
    sql += ' ORDER BY name ASC'
    const rows = await db.prepare(sql).bind(...params).all<{ id: string; name: string; role: string }>()
    return { users: rows.results }
  },
}

export const queryTeams: Capability = {
  name: 'query_teams',
  description: '查询团队列表，获取团队ID和名称。修改线索所属团队前调用此工具确认团队ID。',
  scope: 'meta:read',
  readOnly: true,
  inputSchema: { type: 'object', properties: {} },
  async run({ db }) {
    const rows = await db.prepare('SELECT id, name, region FROM teams ORDER BY name ASC').all<{ id: string; name: string; region: string | null }>()
    return { teams: rows.results }
  },
}

export const whoami: Capability = {
  name: 'whoami',
  description: '查看当前身份：用户名、角色、所属团队，以及本次授权可用的权限范围。角色决定可见数据（销售只能看到自己负责的线索和客户）。',
  scope: null,
  readOnly: true,
  inputSchema: { type: 'object', properties: {} },
  async run({ db }, actor, _input, { scopes }) {
    const user = await db.prepare(
      'SELECT u.name, u.email, t.name AS team_name FROM users u LEFT JOIN teams t ON u.team_id = t.id WHERE u.id = ?',
    ).bind(actor.userId).first<{ name: string; email: string; team_name: string | null }>()
    return {
      userId: actor.userId, name: user?.name ?? null, email: user?.email ?? null, role: actor.role,
      team: user?.team_name ?? null, via: actor.via, scopes: scopes ?? 'all',
    }
  },
}
