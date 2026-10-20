-- Workers AI 每日用量（按 UTC 自然日，与 Cloudflare 免费额度的重置时间一致）：调用次数、token 数、估算 neurons
CREATE TABLE IF NOT EXISTS ai_usage_daily (
  day           TEXT    NOT NULL,
  model_id      TEXT    NOT NULL,
  calls         INTEGER NOT NULL DEFAULT 0,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  neurons       REAL    NOT NULL DEFAULT 0,
  PRIMARY KEY (day, model_id)
);
