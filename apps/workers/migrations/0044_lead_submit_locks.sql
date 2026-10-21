-- 外部提交线索的并发锁：同一联系方式同时提交时只让一个请求查重并新建，其它请求等它完成（用完即删）
CREATE TABLE IF NOT EXISTS lead_submit_locks (
    contact_key TEXT PRIMARY KEY NOT NULL,
    locked_at TEXT NOT NULL
);
