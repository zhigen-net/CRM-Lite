-- 访客统计：站点、访客、访问（会话）、行为事件
-- 采集请求只接受网站服务器端转发（带站点密钥），不存原始 IP（只存哈希与地区）

CREATE TABLE IF NOT EXISTS tracking_sites (
  id                TEXT     PRIMARY KEY NOT NULL,
  name              TEXT     NOT NULL,
  domain            TEXT,
  key_hash          TEXT     NOT NULL UNIQUE,   -- 站点密钥 SHA-256，明文只在创建时返回一次
  key_prefix        TEXT     NOT NULL,
  is_active         INTEGER  NOT NULL DEFAULT 1,
  created_by_userId TEXT,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen_at      DATETIME
);

CREATE TABLE IF NOT EXISTS visitors (
  site_id            TEXT     NOT NULL,
  id                 TEXT     NOT NULL,          -- 浏览器生成的匿名访客 ID
  first_seen_at      DATETIME NOT NULL,
  last_seen_at       DATETIME NOT NULL,
  visit_count        INTEGER  NOT NULL DEFAULT 0,
  pageview_count     INTEGER  NOT NULL DEFAULT 0,
  -- 首次来源（归因用）
  first_channel      TEXT,
  first_referrer     TEXT,
  first_landing      TEXT,
  first_utm_source   TEXT,
  first_utm_medium   TEXT,
  first_utm_campaign TEXT,
  first_click_id_type TEXT,
  -- 最近一次访问的来源与环境
  last_channel       TEXT,
  device_type        TEXT,
  os                 TEXT,
  browser            TEXT,
  country            TEXT,
  region             TEXT,
  city               TEXT,
  isp                TEXT,
  lead_id            TEXT,                       -- 留资后关联的线索
  PRIMARY KEY (site_id, id)
);
CREATE INDEX IF NOT EXISTS idx_visitors_last_seen ON visitors(site_id, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_visitors_lead ON visitors(lead_id);

CREATE TABLE IF NOT EXISTS visits (
  id            TEXT     PRIMARY KEY NOT NULL,   -- 浏览器生成的会话 ID（30 分钟无操作即新会话）
  site_id       TEXT     NOT NULL,
  visitor_id    TEXT     NOT NULL,
  started_at    DATETIME NOT NULL,
  ended_at      DATETIME NOT NULL,
  pageviews     INTEGER  NOT NULL DEFAULT 0,
  duration_sec  INTEGER  NOT NULL DEFAULT 0,
  landing_path  TEXT,
  referrer      TEXT,
  channel       TEXT,                            -- paid / search / social / referral / direct
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  utm_term      TEXT,
  utm_content   TEXT,
  click_id_type TEXT,                            -- 如 bd_vid / gclid / clickid
  click_id      TEXT,
  device_type   TEXT,
  os            TEXT,
  browser       TEXT,
  screen        TEXT,
  language      TEXT,
  network       TEXT,
  country       TEXT,
  region        TEXT,
  city          TEXT,
  isp           TEXT,
  ip_hash       TEXT
);
CREATE INDEX IF NOT EXISTS idx_visits_site_started ON visits(site_id, started_at);
CREATE INDEX IF NOT EXISTS idx_visits_visitor ON visits(site_id, visitor_id, started_at);

CREATE TABLE IF NOT EXISTS track_events (
  id          TEXT     PRIMARY KEY NOT NULL,     -- 浏览器生成，重复上报时忽略
  site_id     TEXT     NOT NULL,
  visitor_id  TEXT     NOT NULL,
  visit_id    TEXT     NOT NULL,
  type        TEXT     NOT NULL,                 -- pageview / leave / tel / wechat / form / custom
  path        TEXT,
  title       TEXT,
  duration_ms INTEGER,
  scroll_pct  INTEGER,
  meta        TEXT,
  created_at  DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_track_events_visit ON track_events(visit_id, created_at);
CREATE INDEX IF NOT EXISTS idx_track_events_site ON track_events(site_id, created_at);
