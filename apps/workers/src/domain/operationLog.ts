// 操作记录：所有入口（界面、对外接口、AI 助手、MCP、网站表单、工作流、系统）的写操作统一记在 audit_log，只增不改
// 线索、客户、跟进记录由业务服务记录（带字段改前改后）；其它管理接口由 crm/middleware/operationLog.ts 按请求记录
import type { Actor } from './actor'

export interface FieldChange { field: string; from: unknown; to: unknown }

export interface OperationEntry {
  /** 业务操作用「对象.动作」，如 lead.update；按请求记录的用「方法 路由」，如 PUT /api/admin/settings */
  action: string
  targetType?: string | null | undefined
  targetId?: string | null | undefined
  targetLabel?: string | null | undefined
  summary?: string | null | undefined
  changes?: FieldChange[] | undefined
  input?: unknown
  status?: 'ok' | 'error' | undefined
  error?: string | null | undefined
  ip?: string | null | undefined
}

// 按请求记录时，路由前缀 → 分类（越具体的放越前面）
const PATH_CATEGORIES: [string, string][] = [
  ['/api/auth/login', 'login'],
  ['/api/auth/api-keys', 'apiKey'],
  ['/api/auth', 'account'],
  ['/api/upload', 'file'],
  ['/api/users', 'user'],
  ['/api/teams', 'team'],
  ['/api/admin/settings', 'settings'],
  ['/api/admin/entity-schema', 'settings'],
  ['/api/admin/options', 'options'],
  ['/api/services', 'service'],
  ['/api/admin/workflows', 'workflow'],
  ['/api/workflows', 'workflow'],
  ['/api/admin/assignment-rules', 'assignment'],
  ['/api/admin/ai', 'aiConfig'],
  ['/api/admin/tracking-sites', 'site'],
  ['/api/tracking', 'site'],
  ['/api/admin/recycle-bin', 'recycleBin'],
  ['/api/admin/api-failures', 'apiFailure'],
  ['/api/milestones', 'milestone'],
  ['/api/partner', 'partner'],
]

/** 操作分类与动作：分类存进 category 列用于筛选，动作在读取时算出，前端按两者翻译 */
export function classifyAction(action: string): { category: string; verb: string } {
  const req = /^(GET|POST|PUT|PATCH|DELETE) (\S+)$/.exec(action)
  if (req) {
    const [, method, path] = req as unknown as [string, string, string]
    const category = PATH_CATEGORIES.find(([p]) => path.startsWith(p))?.[1] ?? 'other'
    const verb = category === 'login' ? 'login'
      : method === 'GET' ? (category === 'file' ? 'download' : 'view')
        : method === 'POST' ? (/restore|regenerate|reset|purge|test|retry/.test(path) ? 'action' : 'create')
          : method === 'DELETE' ? 'delete' : 'update'
    return { category, verb }
  }
  const dotted = /^([a-z]+)\.([a-z]+)$/.exec(action)
  if (dotted) return { category: dotted[1]!, verb: dotted[2]! }
  // AI 助手、对外接口、MCP 的调用记录（能力名，如 update_lead）
  return { category: 'call', verb: action }
}

const INPUT_LIMIT = 1000
const SECRET_KEY = /pass(word)?|secret|token|api_?key|^key$|authorization/i

/** 参数摘要：去掉密码、密钥类字段，截断 */
export function summarizeInput(input: unknown): string | null {
  if (input === undefined || input === null) return null
  const json = JSON.stringify(input, (k, v) => (k && SECRET_KEY.test(k) ? '***' : v))
  return json.slice(0, INPUT_LIMIT)
}

const clip = (v: unknown) => (typeof v === 'string' && v.length > 2000 ? `${v.slice(0, 2000)}…` : v)

/** 写一条操作记录；写入失败只打日志，不影响业务 */
export async function recordOperation(db: D1Database, actor: Pick<Actor, 'userId' | 'via' | 'apiKeyId'> | null, e: OperationEntry): Promise<void> {
  const changes = e.changes && e.changes.length > 0
    ? JSON.stringify(e.changes.map((c) => ({ field: c.field, from: clip(c.from ?? null), to: clip(c.to ?? null) })))
    : null
  await db.prepare(
    `INSERT INTO audit_log (id, user_id, api_key_id, via, action, category, target_type, target_id, target_label,
       summary, changes, input_summary, status, error_message, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), actor?.userId ?? null, actor?.apiKeyId ?? null, actor?.via ?? 'system', e.action,
    classifyAction(e.action).category, e.targetType ?? null, e.targetId ?? null, e.targetLabel?.slice(0, 200) ?? null,
    e.summary?.slice(0, 4000) ?? null, changes, summarizeInput(e.input), e.status ?? 'ok', e.error?.slice(0, 500) ?? null,
    e.ip ?? null,
  ).run().then(() => undefined).catch((err) => console.error('[operation-log] write failed:', err))
}

/** 只记录真正变化的字段 */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>): FieldChange[] {
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  return Object.keys(after).filter((k) => after[k] !== undefined && !same(before[k], after[k]))
    .map((k) => ({ field: k, from: before[k] ?? null, to: after[k] ?? null }))
}

// ─── 查询 ────────────────────────────────────────────────────────────────────

export interface OperationFilters {
  from?: string | undefined
  to?: string | undefined
  userId?: string | undefined
  via?: string | undefined
  category?: string | undefined
  status?: string | undefined
  targetId?: string | undefined
  q?: string | undefined
  page: number
  pageSize: number
}

export async function listOperations(db: D1Database, f: OperationFilters) {
  let where = 'WHERE 1=1'
  const params: unknown[] = []
  const add = (sql: string, ...v: unknown[]) => { where += ` AND ${sql}`; params.push(...v) }
  if (f.from) add('al.created_at >= ?', f.from)
  if (f.to) add('al.created_at < ?', f.to)
  if (f.userId) add('al.user_id = ?', f.userId)
  if (f.via) add('al.via = ?', f.via)
  if (f.category) add('al.category = ?', f.category)
  if (f.status) add('al.status = ?', f.status)
  if (f.targetId) add('al.target_id = ?', f.targetId)
  if (f.q) {
    const like = `%${f.q}%`
    add('(al.target_label LIKE ? OR al.summary LIKE ? OR al.input_summary LIKE ? OR al.action LIKE ?)', like, like, like, like)
  }
  const [count, rows] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total FROM audit_log al ${where}`).bind(...params).first<{ total: number }>(),
    db.prepare(`
      SELECT al.id, al.created_at, al.user_id, u.name AS user_name, al.via, al.action, al.category, al.target_type, al.target_id,
        al.target_label, al.summary, al.changes, al.input_summary, al.status, al.error_message, al.ip,
        ak.name AS api_key_name, ak.key_prefix AS api_key_prefix
      FROM audit_log al
      LEFT JOIN users u ON al.user_id = u.id
      LEFT JOIN api_keys ak ON al.api_key_id = ak.id
      ${where} ORDER BY al.created_at DESC, al.rowid DESC LIMIT ? OFFSET ?`,
    ).bind(...params, f.pageSize, (f.page - 1) * f.pageSize).all<Record<string, unknown>>(),
  ])
  const data = rows.results.map((r) => {
    const action = String(r.action)
    let changes: FieldChange[] | null = null
    try { changes = r.changes ? JSON.parse(String(r.changes)) as FieldChange[] : null } catch { /* 保持 null */ }
    return {
      id: r.id, createdAt: r.created_at, userId: r.user_id, userName: r.user_name, via: r.via, action,
      category: r.category ?? classifyAction(action).category, verb: classifyAction(action).verb,
      targetType: r.target_type, targetId: r.target_id, targetLabel: r.target_label, summary: r.summary, changes,
      inputSummary: r.input_summary, status: r.status, errorMessage: r.error_message, ip: r.ip,
      apiKeyName: r.api_key_name, apiKeyPrefix: r.api_key_prefix,
    }
  })
  return { data, total: count?.total ?? 0, page: f.page, pageSize: f.pageSize }
}
