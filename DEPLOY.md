# 部署指南

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React + Vite，构建产物作为 Worker 静态资源（Static Assets）与 API 一起部署 |
| 后端 | Cloudflare Workers (Hono)，TypeScript；与前端共用同一个 Worker、同一域名 |
| 数据库 | Cloudflare D1（SQLite） |
| 文件存储 | Cloudflare R2 |
| 任务队列 | Cloudflare Queues（线索分配、通知推送） |
| 邮件 | Resend / SendGrid（可选） |

---

## Fork 快速部署（推荐）

Fork 仓库后只需两步即可完成全自动部署：

### 第一步：设置 Cloudflare API Token

在 GitHub 仓库 **Settings → Secrets and variables → Actions** 中添加：

| 类型 | 名称 | 说明 |
|---|---|---|
| **Secret** | `CLOUDFLARE_API_TOKEN` | Cloudflare API Token，需包含 Workers、D1、R2、Queues 的编辑权限 |
| **Secret** | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID（在 CF 控制台右侧边栏查看） |

> 在 Cloudflare 控制台 → My Profile → API Tokens → Create Token 创建，建议使用 "Edit Cloudflare Workers" 模板并额外添加 D1、R2、Queues 权限。

### 第二步：触发 Setup 工作流

在 GitHub Actions 页面手动触发 **Setup** 工作流。

工作流会自动完成：
- 从 `wrangler whoami` 获取 Account ID
- 以 `{owner首词}-{repo首词}-{branch}` 为前缀创建所有 Cloudflare 资源
- 生成随机 `JWT_SECRET` 和 `PORTAL_JWT_SECRET` 并写入 Worker Secrets
- 构建前端，并与 API 一起部署到同一个 Worker
- 执行数据库迁移

完成后 Actions 日志末尾会输出访问地址。

### 后续更新

每次 push 到 `main` 分支会自动触发 **Deploy** 工作流，完成代码部署和数据库迁移。

---

## 自定义资源名称

Setup 工作流会根据仓库信息自动计算资源名称（如 `zhigen-crm-main`）。
如需自定义，在运行 Setup **之前**在 GitHub Variables 中预先设置以下任意项：

| Variable | 说明 | 默认值 |
|---|---|---|
| `WORKER_NAME` | Worker 名称 | `{owner}-{repo}-{branch}` |
| `D1_DATABASE_NAME` | D1 数据库名称 | `{prefix}-db` |
| `R2_BUCKET_NAME` | R2 存储桶名称 | `{prefix}-store` |
| `LEAD_QUEUE_NAME` | 线索分配队列名称 | `{prefix}-leads` |
| `NOTIFY_QUEUE_NAME` | 通知队列名称 | `{prefix}-notify` |

---

## 可选配置（Setup 完成后）

通过 `wrangler secret put` 配置以下可选 Secrets：

| Secret | 说明 |
|---|---|
| `EMAIL_FROM` | 发件人邮箱（默认 `noreply@example.com`） |
| `EMAIL_FROM_NAME` | 发件人名称（默认 `CRM`） |
| `RESEND_API_KEY` | Resend API Key（优先使用） |
| `SENDGRID_API_KEY` | SendGrid API Key（回退选项） |
| `PORTAL_BASE_URL` | 客户门户访问地址，用于生成 Magic Link |

> 未配置邮件 Key 时，发邮件操作静默跳过，不影响其他功能。

---

## 架构说明：单 Worker 部署

前端和 API 部署在**同一个 Worker** 中（Workers Static Assets）：

- `/api/*` 由 Worker 代码处理（`run_worker_first = ["/api/*"]`）
- 其余请求直接命中静态资源；未匹配到文件的路径回退到 `index.html`（SPA 路由）
- 静态资源请求不执行 Worker 代码，**免费且不计入 Workers 请求额度**
- 前端与 API 同源，前端默认以相对路径 `/api` 调用后端，无需配置 API 地址

配置见 `apps/workers/wrangler.toml` 的 `[assets]` 段。部署前必须先构建前端（`pnpm build:web`），根目录的 `pnpm deploy:all` 会自动完成这一步。

> 从旧版（Worker + Pages）升级：首次部署新版后，前端访问地址变为 Worker 的地址（`{worker-name}.{subdomain}.workers.dev` 或绑定的自定义域名）。
> 确认新地址可用后，把原来绑在 Pages 上的自定义域名改绑到 Worker，再在控制台删除旧的 Pages 项目。
> 旧版代码保留在 tag `v1.0.0`。

---

## 自定义域名

在 Cloudflare 控制台手动绑定：
- Workers & Pages → 对应 Worker → Settings → Domains & Routes

前端和 API 共用这一个域名，无需额外配置。

如需让前端改为调用其它地址的 API，可在 GitHub Secrets 中设置 `VITE_API_BASE_URL`（构建时编译进前端），然后重新部署。不设置时前端使用同源 `/api`。

---

## 本地开发

```bash
pnpm install

# 启动前端开发服务器（http://localhost:5173，/api 代理到 8787）
pnpm --filter web dev

# 启动 Workers 本地模拟（http://localhost:8787）
pnpm --filter workers dev
```

> Worker 绑定了 Workers AI，本地开发需要先 `npx wrangler login`（或设置 `CLOUDFLARE_API_TOKEN`）。

部署（需已配置 wrangler.toml 中的资源名）：

```bash
pnpm deploy:all   # 先构建前端，再 wrangler deploy
```

`apps/workers/.dev.vars` 示例（本地开发用，不提交）：

```
JWT_SECRET=dev-secret-change-in-production
PORTAL_JWT_SECRET=dev-portal-secret
EMAIL_FROM=dev@example.com
EMAIL_FROM_NAME=CRM Dev
RESEND_API_KEY=
PORTAL_BASE_URL=http://localhost:5173
```

本地 wrangler.toml 需要对应的环境变量，在 `.dev.vars` 同级创建 `.env` 文件或直接 export：

```bash
export CLOUDFLARE_ACCOUNT_ID=你的账户ID
export WORKER_NAME=crm-workers-dev
export D1_DATABASE_NAME=crm-db-dev
export D1_DATABASE_ID=你的D1数据库ID
export R2_BUCKET_NAME=crm-storage-dev
export LEAD_QUEUE_NAME=lead-assignment-queue-dev
export NOTIFY_QUEUE_NAME=notification-queue-dev
```

---

## 数据库迁移

迁移文件位于 `apps/workers/migrations/`，命名规则 `NNNN_描述.sql`。

```bash
# 手动应用到远端
cd apps/workers
npx wrangler d1 migrations apply "$D1_DATABASE_NAME" --remote
```
