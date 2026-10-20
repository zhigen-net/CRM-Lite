-- 访客 IP：按用户要求保存完整 IP（只给管理员、运营查看；API / MCP 无联系方式权限时打码）
-- 每次访问记录当时的 IP；访客上记最近一次访问的 IP，方便列表展示
ALTER TABLE visits ADD COLUMN ip TEXT;
ALTER TABLE visitors ADD COLUMN last_ip TEXT;
