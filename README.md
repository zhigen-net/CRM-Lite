# 客路 Kelu

> 从访客到客户，一条路。

**开源、运行在 Cloudflare 上、AI 优先的 HubSpot 替代方案**，覆盖获客到服务的全流程：

```
访客 ──留资──▶ 线索 ──转化──▶ 客户 ──签约──▶ 服务交付
```

- **无需服务器**：完全运行在 Cloudflare（Workers + D1 + R2 + Queues），fork 后连接 Workers Builds 即可部署，GitHub 中不需要配置任何 Secret，小团队几乎零成本。
- **AI 优先**：内置 AI 助手；提供 MCP 服务，Claude Code、Cursor、Claude Desktop 等 AI 工具可以直接查询和维护线索、客户，权限与界面一致，所有调用记入审计日志。
- **通用核心 + 行业模板**：核心功能与行业无关，首次初始化时可选择「通用」或行业模板（目前提供「辅助生殖」），预置服务流程、选项和 AI 业务背景。
- **数据自有**：所有数据在你自己的 Cloudflare 账号中。

[English](./README.en.md)

## 功能

**内部 CRM（`/app`）**
- 线索管理：录入、分配、跟进、转化为客户；支持按规则自动分配
- 客户档案：客户详情、服务进度里程碑、下次联系提醒、附件
- 产品与服务：服务项目、价格、交付步骤与服务资料
- 销售活动：跟进记录、附件
- 工作流：可视化编辑，支持定时执行
- AI 助手：用自然语言查询和维护数据，详情页一键「让 AI 分析」；支持 OpenAI、Anthropic、Cloudflare Workers AI 及自定义兼容接口；可配置业务背景
- AI 接入：MCP 服务（`/api/mcp`）、API Key 权限范围、审计日志
- 用户、团队与权限，字段级策略，回收站
- 对外 API：通过 API Key 推送线索（`POST /api/v1/leads`），机器可读说明见 `/api/v1/llms.txt`
- 访客分析：网站通过同域 `/_t/*` 转发接入（不暴露 CRM 地址），记录来源渠道、访问轨迹和关键行为，在「访客 → 站点管理」中按接入向导完成，向导可自动检测接入是否正确

**客户门户（`/portal`，默认关闭，在「系统设置 → 基本设置」开启）**
- 客户登录，查看个人资料、服务、资源文件和进度

**其它**
- 中英文界面
- 邮件通知（Resend / SendGrid，可选）

**规划中**：访客与线索关联、渠道汇总报表、自定义字段、线索打分、统一时间线。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18 + Vite + TypeScript + Tailwind CSS，TanStack Query，Zustand，i18next |
| 后端 | Cloudflare Workers + Hono + Zod |
| 数据库 | Cloudflare D1（SQLite） |
| 文件存储 | Cloudflare R2 |
| 异步任务 | Cloudflare Queues（线索分配、通知），Cron 定时任务（工作流） |
| AI | Workers AI 或外部模型接口 |

前端和 API 部署在**同一个 Worker** 中：`/api/*` 由 Worker 代码处理，其余请求直接返回静态资源（免费，不计入请求额度）。

## 目录结构

```
apps/
  web/                 前端（React + Vite）
    src/app/           内部 CRM 页面
    src/portal/        客户门户页面
    src/i18n/locales/  中英文语言包
  workers/             后端 Worker（Hono）
    src/crm/           内部 CRM API
    src/portal/        客户门户 API
    src/assignment/    线索分配队列消费者
    src/notification/  通知队列消费者
    migrations/        D1 数据库迁移
    wrangler.toml      Worker 配置（资源名为占位符）
scripts/
  cf-deploy.sh         部署脚本（Workers Builds 每次构建时执行）
```

## 部署

通过 Cloudflare **Workers Builds** 自动部署：在 Cloudflare 控制台把 Worker 连接到本仓库后，每次 push 自动构建和部署。**安装和部署都不需要修改代码。**

快速开始：

0. 每个 Cloudflare 账号一次：启用 R2，并创建部署用的 API Token（权限清单见 [DEPLOY.md](./DEPLOY.md#前置条件每个-cloudflare-账号一次)）
1. Cloudflare 控制台 → **Workers & Pages** → **Create** → **Import a repository**，选择本仓库
2. Worker 名填环境名（如 `crm-main`），Deploy command 填 `pnpm run cf:deploy`，Build command 留空，API token 选择自建 Token（需含 D1、Queues 权限，见 DEPLOY.md）
3. Settings → Build → Branch control：取消勾选 **Enable Preview Builds**
4. 首次构建会自动创建数据库、存储桶、队列和登录密钥；部署完成后打开 Worker 地址，按提示创建管理员账号

建议的环境划分：`main` 分支 → 生产，`dev` 分支 → 测试，各自使用独立的数据和资源。

完整说明（前置条件、现有环境迁移、可选配置、自定义域名、回滚）见 **[DEPLOY.md](./DEPLOY.md)**。

## 本地开发

需要 Node.js 22+ 和 pnpm 9。

```bash
pnpm install

# 前端：http://localhost:5173（/api 自动代理到 8787）
pnpm dev:web

# 后端：http://localhost:8787
pnpm dev:workers

# 初始化本地数据库
pnpm db:migrate:local
```

后端本地开发需要先 `npx wrangler login`（Workers AI 绑定需要连接 Cloudflare），并在 `apps/workers/.dev.vars` 配置本地密钥，示例见 [DEPLOY.md](./DEPLOY.md#本地开发)。

常用命令：

| 命令 | 说明 |
|---|---|
| `pnpm typecheck` | 全部包类型检查 |
| `pnpm build:web` | 构建前端 |
| `APP_NAME=<worker名> pnpm run cf:deploy` | 从本地手动部署（一般不需要） |

### 数据库迁移

在 `apps/workers/migrations/` 新增 `NNNN_描述.sql`，部署时会在新代码上线**之前**自动执行。迁移需要保持向后兼容（只加表、加字段，不删除、不改名），以便回滚代码时旧版本仍能运行。

## 版本

- `v1.0.0`：Worker + Pages + GitHub Actions 部署架构的最后版本
- 当前：单 Worker + Workers Builds 自动部署

## 许可证

[AGPL-3.0](./LICENSE)。修改后以网络服务形式提供给他人使用时，需要按许可证公开修改后的源代码。

## 相关文档

- [AGENTS.md](./AGENTS.md)：开发约定（分支流程、迁移规则等，开发者和编码 agent 都须遵守）
- [DEPLOY.md](./DEPLOY.md)：部署与运维
- [CRM_Development_Guide.md](./CRM_Development_Guide.md)：最初的系统设计文档（架构部分描述的是早期的 Pages + Workers 方案）
