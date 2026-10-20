-- 访问轨迹显示完整网址：一个站点可能有多个域名（多个落地页站），记下每个事件、每次访问所在的域名
ALTER TABLE track_events ADD COLUMN host TEXT;
ALTER TABLE visits ADD COLUMN landing_host TEXT;
ALTER TABLE visitors ADD COLUMN first_host TEXT;
