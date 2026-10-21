-- 操作记录：audit_log 扩展为所有入口的统一操作记录（只增不改）
ALTER TABLE audit_log ADD COLUMN category TEXT;      -- 分类：lead / client / activity / user / settings / login / call …
ALTER TABLE audit_log ADD COLUMN target_label TEXT;  -- 对象名称（如线索编号 + 姓名），对象删除后仍可读
ALTER TABLE audit_log ADD COLUMN summary TEXT;       -- 操作说明
ALTER TABLE audit_log ADD COLUMN changes TEXT;       -- 字段改前改后 JSON：[{field, from, to}]
ALTER TABLE audit_log ADD COLUMN ip TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_category ON audit_log(category, created_at);

-- 已有的调用记录：分类为 call
UPDATE audit_log SET category = 'call' WHERE category IS NULL;

-- 历史：跟进记录与系统变更记录导入操作记录（入口记为 history）
INSERT OR IGNORE INTO audit_log (id, user_id, via, action, category, target_type, target_id, target_label, summary, status, created_at)
SELECT 'act-' || a.id, a.user_id, 'history',
  CASE WHEN a.activity_type = 'System' THEN 'activity.system' ELSE 'activity.create' END, 'activity',
  CASE WHEN a.client_id IS NOT NULL THEN 'client' ELSE 'lead' END,
  COALESCE(a.client_id, a.lead_id),
  CASE WHEN a.client_id IS NOT NULL THEN c.name
       ELSE (CASE WHEN l.lead_no IS NOT NULL THEN 'L-' || substr('0000' || l.lead_no, -4) || ' ' ELSE '' END) || l.name END,
  CASE WHEN a.activity_type = 'System' THEN a.description ELSE '[' || a.activity_type || '] ' || COALESCE(a.description, '') END,
  'ok', a.created_at
FROM sales_activities a
LEFT JOIN leads l ON l.id = a.lead_id
LEFT JOIN clients c ON c.id = a.client_id;
