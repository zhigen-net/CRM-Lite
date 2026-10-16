-- 线索关联网站访客：表单提交时带上的访客 ID（crm_vid）
-- 只存访客 ID；站点由 visitors 表推出（访客 ID 是随机 UUID）
ALTER TABLE leads ADD COLUMN visitor_id TEXT;
CREATE INDEX IF NOT EXISTS idx_leads_visitor ON leads(visitor_id);
