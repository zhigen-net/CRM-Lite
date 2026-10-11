# CRM 域名中转（Cloudflare Pages）

Worker 不能绑定其他 Cloudflare 账号下的域名。这个分支是一个只含转发逻辑的 Pages 项目：
把它部署到域名所在的账号，绑定自定义域名，所有请求会原样转发到 `TARGET_URL`。

> 本分支只放中转代码，与 `main` 无共同历史，**不要合并进 `main`**。

## 部署（全部在 Cloudflare 控制台完成）

1. 登录**域名所在的** Cloudflare 账号 → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. 选择本仓库，生产分支选择本分支
3. 构建设置：
   - Framework preset：`None`
   - Build command：留空
   - Build output directory：`public`
   - Root directory：留空
4. **Environment variables** 添加：
   - `TARGET_URL` = Worker 地址，例如 `https://zhigen-crm-main.xxx.workers.dev`
5. 保存并部署，然后在项目的 **Custom domains** 里绑定你的域名

修改 `TARGET_URL` 后需要在 **Deployments** 里对最新部署点 **Retry deployment**（或推送一次代码）才会生效。

## 转发行为

- 路径、查询参数、请求方法、请求体、请求头原样转发；`TARGET_URL` 可以带路径前缀
- 附加 `X-Forwarded-Host` / `X-Forwarded-Proto` / `X-Forwarded-For`
- 上游返回指向 Worker 域名的重定向，`Location` 会改写为当前域名
- 去掉 `Set-Cookie` 的 `Domain` 属性，Cookie 落在当前域名
- 支持 WebSocket

## 注意

CRM 门户邮件中的链接默认取请求的 origin（经中转后是 Worker 域名），
如需使用自定义域名，请在 Worker 上设置 `PORTAL_BASE_URL`。
