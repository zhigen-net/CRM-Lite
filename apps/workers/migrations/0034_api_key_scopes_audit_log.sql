-- API Key 权限范围：JSON 数组，取值见 src/domain/capabilities/types.ts 的 SCOPES。
-- 已有的密钥只用于推送线索，默认只授予 leads:create，行为不变。
ALTER TABLE api_keys ADD COLUMN scopes TEXT NOT NULL DEFAULT '["leads:create"]';

-- 审计日志：记录通过对外接口、AI 助手、MCP 等非界面入口发生的调用
CREATE TABLE IF NOT EXISTS audit_log (
  id            TEXT     PRIMARY KEY NOT NULL,
  user_id       TEXT,
  api_key_id    TEXT,
  via           TEXT     NOT NULL,   -- api | assistant | mcp
  action        TEXT     NOT NULL,   -- 能力名，如 update_lead
  target_type   TEXT,                -- lead | client
  target_id     TEXT,
  input_summary TEXT,                -- 输入参数（截断）
  status        TEXT     NOT NULL,   -- ok | error
  error_message TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, created_at);
