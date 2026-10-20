-- 降低访客统计的读取量：
-- 1. 访客上记「关键行为」次数（点电话、复制微信、提交表单），访客列表不再逐个统计事件表
-- 2. 访问表按开始时间的索引，仪表盘按时间统计访客时使用
ALTER TABLE visitors ADD COLUMN key_actions INTEGER NOT NULL DEFAULT 0;
UPDATE visitors SET key_actions = (
  SELECT COUNT(*) FROM track_events e WHERE e.site_id = visitors.site_id AND e.visitor_id = visitors.id AND e.type IN ('tel', 'wechat', 'form')
);
CREATE INDEX IF NOT EXISTS idx_visits_started ON visits(started_at);
