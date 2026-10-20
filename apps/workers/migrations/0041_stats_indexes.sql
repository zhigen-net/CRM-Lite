-- 仪表盘按时间范围统计：线索、客户、跟进记录按创建时间查询
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_clients_created ON clients(created_at);
CREATE INDEX IF NOT EXISTS idx_sa_created ON sales_activities(created_at);
