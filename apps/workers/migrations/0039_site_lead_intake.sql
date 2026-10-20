-- 网站表单留资（/_t/lead → /api/t/lead）：与 /api/v1/leads 共用 domain/leads/submit.ts 的处理逻辑
-- 失败记录标明来自哪个站点（来自 API Key 的仍记 api_key_prefix）
ALTER TABLE api_lead_failures ADD COLUMN site_id TEXT;

-- 网站留资提交记录：用于按 IP / 访客限制提交频率，以及排查被拦截的提交
CREATE TABLE IF NOT EXISTS site_lead_submissions (
  id          TEXT     PRIMARY KEY NOT NULL,
  site_id     TEXT     NOT NULL,
  ip_hash     TEXT,
  visitor_id  TEXT,
  status      TEXT     NOT NULL,   -- ok | invalid | rate_limited | spam | error
  lead_id     TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_site_lead_sub_ip ON site_lead_submissions(site_id, ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_site_lead_sub_visitor ON site_lead_submissions(site_id, visitor_id, created_at);
