-- 定时工作流执行记录：防止同一工作流对同一记录、同一触发条件每天重复执行
-- trigger_key 含义随条件不同：
--   date_is_today     当天日期
--   date_overdue      逾期的日期字段值（字段被改成新日期后再次逾期会重新触发）
--   no_activity_days  最近一次跟进日期（有新跟进后再次长期无跟进会重新触发）
CREATE TABLE IF NOT EXISTS workflow_scheduled_runs (
  workflow_id TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  trigger_key TEXT NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workflow_id, entity_id, trigger_key)
);
