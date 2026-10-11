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

## 部署方式

使用 Cloudflare **Workers Builds**（Cloudflare 内置的 Git 自动部署）：

- 安装时在 Cloudflare 控制台把 Worker 连接到本仓库，**之后每次 push 自动部署**
- 不使用 GitHub Actions，GitHub 中无需配置任何 Secret
- **无需修改任何代码**即可安装或部署：所有资源名由 Worker 名自动推导

每次构建执行 `pnpm run cf:deploy`（即 `scripts/cf-deploy.sh`），它是幂等的：

1. 由 Worker 名推导资源名，缺失的 D1 / R2 / Queue 自动创建，已存在的直接沿用
2. 构建前端
3. 执行 D1 迁移（先迁移）
4. 部署 Worker（后部署）
5. `JWT_SECRET` / `PORTAL_JWT_SECRET` 不存在时随机生成，已存在的永不改动

资源命名规则（`<name>` 为 Worker 名）：

| 资源 | 名称 |
|---|---|
| D1 数据库 | `<name>-db` |
| R2 存储桶 | `<name>-store` |
| 线索分配队列 | `<name>-leads` |
| 通知队列 | `<name>-notify` |

---

## 环境划分

| 环境 | 分支 | Worker 名（示例） |
|---|---|---|
| 生产 | `main` | `zhigen-crm-main` |
| 测试 | `dev` | `zhigen-crm-dev` |

两个环境各自拥有独立的 D1 / R2 / Queue，互不影响。日常流程：功能合入 `dev` → 测试环境自动更新 → 验证后合入 `main` → 生产自动更新。

---

## 安装（每个环境一次，全部在 Cloudflare 控制台完成）

### 前置条件（每个 Cloudflare 账号一次）

1. 账号首次使用 R2：控制台 → R2 → 点击启用
2. 创建部署用的 API Token：控制台右上角头像 → **My Profile** → **API Tokens** → **Create Token** → **Create Custom Token**，授予以下权限：

| 类别 | 权限 | 级别 |
|---|---|---|
| Account | Account Settings | Read |
| Account | Workers Scripts | Edit |
| Account | Workers R2 Storage | Edit |
| Account | D1 | Edit |
| Account | Queues | Edit |
| User | User Details | Read |
| User | Memberships | Read |

> Workers Builds 默认自动生成的 Token **不含 D1 和 Queues 权限**，部署脚本会在查询数据库时失败，所以必须使用这个自建 Token。同一账号下的所有环境可共用它。

3. 测试环境需要仓库中存在 `dev` 分支

### 新建环境（测试环境 / 新安装 / fork 部署）

1. Cloudflare 控制台 → **Workers & Pages** → **Create** → **Import a repository**
2. 授权并选择本仓库
3. 填写：

| 设置项 | 值 |
|---|---|
| Project / Worker name | 环境名，如 `zhigen-crm-dev`（决定所有资源名） |
| Production branch | `dev`（测试）或 `main`（生产） |
| Build command | 留空 |
| Deploy command | `pnpm run cf:deploy` |
| Root directory | `/`（默认） |
| API token | 选择前置条件中创建的 Token |

4. 保存并部署。首次构建会自动创建数据库、存储桶、队列和密钥。
5. Worker → **Settings** → **Build** → **Branch control**：取消勾选 **Enable Preview Builds**。

> ⚠️ 第 5 步必须做：本项目只用 `main` / `dev` 两个固定环境，不使用预览构建；预览构建执行的是 `npx wrangler preview`，不经过部署脚本，会因配置中的占位符而失败。

### 现有生产环境接入（从 GitHub Actions 迁移）

现有 Worker 已经有数据库、存储、队列和密钥，接入后会原样沿用：

1. 控制台 → 打开现有 Worker（如 `zhigen-crm-main`）→ **Settings** → **Build** → **Connect**
2. 选择本仓库，分支 `main`，Build command 留空，Deploy command 填 `pnpm run cf:deploy`，API token 选择前置条件中创建的 Token
3. 同样取消勾选 **Enable Preview Builds**
4. 在 GitHub 仓库 Settings → Secrets 中删除不再使用的 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`VITE_API_BASE_URL`

### 首次访问

部署完成后访问 `https://<name>.<你的子域>.workers.dev`（或绑定的自定义域名），首次打开会进入初始化页面创建管理员账号。

---

## 若构建报权限错误

构建日志出现 `Authentication error` / `10000` 等权限错误时，检查 Worker → **Settings** → **Build** → **API token** 是否选择了前置条件中创建的 Token，以及该 Token 是否包含上表全部权限。修改后在 **Deployments** 中重试构建。

---

## 可选配置（控制台 → Worker → Settings → Variables & Secrets）

| Secret | 说明 |
|---|---|
| `EMAIL_FROM` | 发件人邮箱（默认 `noreply@example.com`） |
| `EMAIL_FROM_NAME` | 发件人名称（默认 `CRM`） |
| `RESEND_API_KEY` | Resend API Key（优先使用） |
| `SENDGRID_API_KEY` | SendGrid API Key（回退选项） |
| `PORTAL_BASE_URL` | 客户门户访问地址，用于生成 Magic Link；不设置时使用当前访问的域名 |

> 未配置邮件 Key 时，发邮件操作静默跳过，不影响其他功能。
> 以上配置可以用 Secret 或普通变量（Text）设置，部署时都会保留（部署脚本使用 `wrangler deploy --keep-vars`）。

构建变量（Settings → Build → Build variables）：

| 变量 | 说明 |
|---|---|
| `VITE_API_BASE_URL` | 让前端调用其它地址的 API；不设置时使用同源 `/api`（推荐） |
| `APP_NAME` | 一般无需设置：Workers Builds 会自动提供 Worker 名（`WRANGLER_CI_OVERRIDE_NAME`） |

---

## 自定义域名

控制台 → 对应 Worker → **Settings** → **Domains & Routes** 添加。前端和 API 共用这一个域名，无需其它配置。

---

## 架构说明：单 Worker

前端和 API 部署在同一个 Worker 中（配置见 `apps/workers/wrangler.toml` 的 `[assets]` 段）：

- `/api/*` 由 Worker 代码处理（`run_worker_first = ["/api/*"]`）
- 其余请求直接命中静态资源；未匹配文件的路径回退到 `index.html`（SPA 路由）
- 静态资源请求不执行 Worker 代码，免费且不计入 Workers 请求额度

`wrangler.toml` 中的资源名均为占位符，由部署脚本在构建时替换（生成临时文件 `wrangler.deploy.toml`，不修改仓库文件）。

> 旧版（Worker + Pages + GitHub Actions）代码保留在 tag `v1.0.0`。

---

## 日志与排错

`wrangler.toml` 中已开启 `[observability]`，Worker 的 `console.log`、未捕获异常和每个请求都会持久化保存（免费版每天 20 万条，保留 3 天）。

- 查看：控制台 → 对应 Worker → **Observability** / **Logs**，可按路径、状态码、错误信息筛选
- 构建失败：控制台 → 对应 Worker → **Deployments** → 点开失败的构建查看日志

---

## 回滚

控制台 → Worker → **Deployments** → 选择历史版本 → **Rollback**。
注意：回滚只回退代码，不回退数据库迁移，所以迁移应保持向后兼容（只加表/加字段，不删除、不改名）。

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

`apps/workers/.dev.vars` 示例（本地开发用，不提交）：

```
JWT_SECRET=dev-secret-change-in-production
PORTAL_JWT_SECRET=dev-portal-secret
EMAIL_FROM=dev@example.com
EMAIL_FROM_NAME=CRM Dev
RESEND_API_KEY=
PORTAL_BASE_URL=http://localhost:5173
```

### 从本地手动部署（一般不需要）

```bash
npx wrangler login
APP_NAME=zhigen-crm-dev pnpm run cf:deploy
```

---

## 数据库迁移

迁移文件位于 `apps/workers/migrations/`，命名规则 `NNNN_描述.sql`。每次部署自动执行，无需手动操作。
