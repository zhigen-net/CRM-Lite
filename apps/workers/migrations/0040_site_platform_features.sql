-- 站点的部署平台与功能开关：接入向导按这两项生成对应平台、对应功能的接入步骤和提示词
-- platform：cloudflare_pages / cloudflare_workers / vercel / netlify / edgeone_pages / nginx / php / node / other / static
-- features：JSON，如 {"forms":true}；统计是基础功能，始终开启
ALTER TABLE tracking_sites ADD COLUMN platform TEXT;
ALTER TABLE tracking_sites ADD COLUMN features TEXT;
