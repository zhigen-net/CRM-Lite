// 行业模板：首次初始化时选择。核心功能与行业无关，行业相关内容（示例服务、合作伙伴类型、
// AI 提示词里的行业描述、业务背景）只通过模板写入，代码里不要写死某个行业。
//
// 历史原因：早期迁移（0002 / 0006 / 0027）已内置辅助生殖示例数据，且已合入的迁移不能修改，
// 因此「空白模板」在初始化时把这些示例数据清除或改为通用内容。只在库里还没有任何用户时调用。

export const INDUSTRY_TEMPLATES = ['blank', 'fertility'] as const
export type IndustryTemplate = typeof INDUSTRY_TEMPLATES[number]

/** 业务背景：写入 system_settings.industry_context，供 AI 分析、AI 助手、MCP 了解业务 */
const INDUSTRY_CONTEXT: Record<IndustryTemplate, string> = {
  blank: '',
  fertility: '辅助生殖（试管婴儿、供卵、供精、代孕等）咨询与服务机构。客户多为有生育需求的家庭，决策周期长、对隐私高度敏感，服务涉及海外医疗机构与合作伙伴。',
}

// 迁移内置的辅助生殖示例数据
const FERTILITY_SERVICE_IDS = ['svc-001', 'svc-002', 'svc-003', 'svc-004']
const FERTILITY_PARTNER_TYPE_IDS = ['pt-1', 'pt-2', 'pt-3']
const BUILTIN_PROMPT_IDS = ['builtin-lead-analysis', 'builtin-client-analysis']

export async function applyIndustryTemplate(db: D1Database, template: IndustryTemplate): Promise<void> {
  const setContext = db.prepare(
    `INSERT INTO system_settings (key, value, updated_at) VALUES ('industry_context', ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  ).bind(INDUSTRY_CONTEXT[template])
  if (template === 'fertility') {
    await setContext.run()
    return
  }

  const ph = (ids: string[]) => ids.map(() => '?').join(', ')
  await db.batch([
    db.prepare(`DELETE FROM services WHERE id IN (${ph(FERTILITY_SERVICE_IDS)})`).bind(...FERTILITY_SERVICE_IDS),
    db.prepare(`DELETE FROM option_items WHERE id IN (${ph(FERTILITY_PARTNER_TYPE_IDS)})`).bind(...FERTILITY_PARTNER_TYPE_IDS),
    db.prepare(
      `INSERT OR IGNORE INTO option_items (id, group_key, value, label, color, sort_order) VALUES
        ('pt-g1', 'partner_type', 'Supplier', '供应商',   'blue',   1),
        ('pt-g2', 'partner_type', 'Agency',   '服务机构', 'purple', 2),
        ('pt-g3', 'partner_type', 'Channel',  '渠道合作', 'green',  3)`,
    ),
    // 内置 AI 提示词改为通用表述（行业信息改由业务背景提供）
    db.prepare(
      `UPDATE ai_prompts SET
         system_prompt = REPLACE(system_prompt, '医疗辅助生殖行业 ', ''),
         user_prompt_template = REPLACE(REPLACE(user_prompt_template, '["代孕服务","试管婴儿"]', '["服务A","服务B"]'), '["代孕服务"]', '["服务A"]'),
         updated_at = datetime('now')
       WHERE id IN (${ph(BUILTIN_PROMPT_IDS)})`,
    ).bind(...BUILTIN_PROMPT_IDS),
    setContext,
  ])
}

/** 读取业务背景（未设置时为空字符串） */
export async function getIndustryContext(db: D1Database): Promise<string> {
  const row = await db.prepare("SELECT value FROM system_settings WHERE key = 'industry_context'").first<{ value: string }>()
  return row?.value?.trim() ?? ''
}

/** 拼到 AI 系统提示词末尾的业务背景段落；未设置时为空 */
export function industryContextBlock(context: string): string {
  return context ? `\n\n业务背景：${context}` : ''
}
