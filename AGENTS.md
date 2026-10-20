# AGENTS.md — 开发约定

本文件是所有开发者和编码 agent（Claude Code、Codex、Cursor 等）在本仓库工作时必须遵守的约定。
只记录"读代码看不出来、做错了会出事"的规则；架构与部署细节见 [README.md](./README.md)、[DEPLOY.md](./DEPLOY.md)。

**定位**：产品名「客路 Kelu」（仓库与 Worker 名不变）。开源（AGPL-3.0）、运行在 Cloudflare 上、AI 优先的 HubSpot 替代方案，覆盖 访客 → 线索 → 客户 → 服务交付。核心功能与行业无关。

> [CRM_Development_Guide.md](./CRM_Development_Guide.md) 是早期设计文档，架构和部署部分已过时，与代码冲突时以代码为准，不要据此实现。

## 维护本文件

- 用户在对话中定下新的长期偏好（"以后都……"、"不要再……"）时，在**同一个 PR** 中把它写进本文件。
- 只写长期有效的规则，不写临时任务、密钥、账号 ID、内部地址。
- 保持精简（150 行以内）；能链接到其它文档的内容不要复制。

## 分支与发布

- 两个固定环境，由 Cloudflare Workers Builds 在 push 后自动部署：
  - `dev` 分支 → 测试 Worker `crm-dev`
  - `main` 分支 → 生产 Worker
- 所有改动先合入 `dev`，在 `crm-dev` 验证通过后，再由 `dev` 合入 `main`。**不要直接 push `main`**，也不要从功能分支直接向 `main` 开 PR。
- 功能分支从 `dev` 拉出，PR 的目标分支是 `dev`。
- 在 Cloudflare 上连接本仓库的每个 Worker / Pages 项目都要**关闭预览构建**（Preview Builds / Preview branches），否则其它分支和 PR 会触发必然失败的构建检查。
- 部署只走 Workers Builds（`pnpm run cf:deploy` → `scripts/cf-deploy.sh`）。**不要加回 GitHub Actions 部署**，不要引入需要在 GitHub 配置 Secret 的流程。
- `apps/workers/wrangler.toml` 中的资源名（`placeholder-*`、全零 `database_id`）是占位符，由部署脚本替换。**不要改成真实值**，不要提交 `wrangler.deploy.toml`。

## 数据库（D1）

- 迁移放在 `apps/workers/migrations/`，命名 `NNNN_描述.sql`，编号递增。
- **迁移必须向后兼容**：只加表、加字段、加索引；不删除、不改名、不改类型。原因：部署时先迁移后发布代码，且控制台回滚只回退代码、不回退数据库。确需删除时，先发布不再使用该字段的代码，下一个版本再删。
- **不要修改已合入的迁移文件**，修正请新增迁移。

## 业务规则分层

- 业务规则（参数校验、权限与可见范围、写库、附带处理）写在 `apps/workers/src/domain/`，各入口（`/api/*` 路由、`/api/v1`、AI 助手工具、以后的 MCP）只做参数解析和响应格式，**不要在入口里直接写库或重复实现规则**。
- 已迁移：`domain/leads/`（线索）、`domain/clients/`（客户、线索转化）、`domain/activities/`（跟进记录、附件、里程碑推进）。每个目录下 `policy.ts` 定义可见范围与修改权限，`service.ts` 负责读写及附带处理（线索数、系统变更记录、分配队列、工作流）。工作流改字段统一走 `domain/workflowWrites.ts`（以系统身份调用上述服务，不写变更记录、不再触发工作流，避免循环）。
- 对 AI 开放的能力（AI 助手工具、MCP 工具 `/api/mcp`）统一登记在 `domain/capabilities/`：名称、说明、输入 schema、所需 scope 只定义一次，各入口从注册表生成工具列表并通过 `invokeCapability` 调用，不要在入口里单独定义工具。
- MCP 主要给管理员、客服日常维护线索和客户使用：界面上新增可维护的字段或操作时，同步在能力注册表开放（走同一套 domain 权限规则），不要只做成推送或只读。
- 通过 API Key / MCP 读取时，没有 `contacts:read` 权限的联系方式会打码（`domain/capabilities/redact.ts`）；能力返回新的联系方式字段时同步补充 `CONTACT_KEYS`。非界面入口的调用记录在 `audit_log`（`domain/audit.ts`）。
- 跟进记录和附件的写库语句只在 `domain/activities/records.ts`，其它地方不要直接 INSERT。
- 下载 R2 文件前必须经过 `domain/files.ts` 的权限检查（销售只能下载自己负责的线索/客户下的附件）；新增文件类型时同步补充规则。
- 选项类字段（状态、合同状态、丢失原因等）和日期字段写库前用 `domain/validation.ts` 校验（选项值必须在「选项配置」中启用；日期 `YYYY-MM-DD`），新增此类字段时同步调用。
- 业务错误抛 `DomainError`（带状态码），由入口转换：HTTP 接口返回对应状态码，AI 助手工具返回 `{ error }`。
- 外部提交线索（`/api/v1/leads`、网站表单 `/api/t/lead`、AI 能力 `create_lead`、失败补录）统一走 `domain/leads/submit.ts` 的 `submitExternalLead`：校验、字段别名、整理、新建、审计、失败记录只在这里实现，入口只做鉴权和响应格式，保证各入口数据一致。
- 对外接口 `/api/v1/*` 的字段或行为变化时，同步更新 `crm/routes/v1Docs.ts`（`llms.txt` / `openapi.json`）和前端接入提示词（`profile.api.prompt.*`），AI 接入依赖它们。

## 通用核心与行业模板

- 代码、界面文案、默认值、示例中**不要写死某个行业**（如辅助生殖的服务名、术语）。行业相关内容只通过 `domain/templates.ts` 的行业模板在初始化时写入，或由用户在系统中配置；AI 需要的行业信息放在「业务背景」设置（`industry_context`）中。
- 早期迁移已内置辅助生殖示例数据，且不能修改；「通用」模板在初始化时清除它们。新增行业示例数据时写进模板，不要写进迁移。

## 访客统计

- 网站只通过同域 `/_t/*` 接入，由网站的 Pages Function / Worker 在服务器端带站点密钥转发到 CRM 的 `/api/t/*`（模板见 `domain/tracking/integration.ts`）。**采集脚本和网站前端里不能出现 CRM 地址或任何密钥**；`/api/t/*` 不开放跨域。
- 各部署平台的转发模板在 `domain/tracking/platforms.ts`，都必须遵守同一份转发协议 `PROXY_SPEC`（转发到 `/api/t/*`、带 `X-Site-Key` 与 `X-Visitor-Geo`、不转发 Cookie）；新增或修改模板后要实际跑通 `t.js` 与 `collect` / `lead` 的 `{"ping":1}` 探测。接入提示词由前端 `app/sites/prompt.ts` 按平台和功能拼装。
- 网站表单线索的来源记为站点域名（未填域名时用站点名称），提示词不让网站自填 source；从哪个页面提交看访问轨迹。
- 访客 IP 保存完整值（用户决定，长期保留），只给管理员、运营查看；销售查看线索 / 客户来源时去掉 IP，API / MCP 无 `contacts:read` 时打码。浏览器上报的字段一律截断、校验，视为不可信。

## Workers 运行时

- Worker 有 CPU 时间限制：不要引入重 CPU 的纯 JS 库（例如已因此把 bcryptjs 换成 Web Crypto PBKDF2，见 `apps/workers/src/shared/password.ts`）。优先用 Web Crypto 等平台原生 API。
- `JWT_SECRET` / `PORTAL_JWT_SECRET` 由部署脚本仅在不存在时生成。**任何改动都不能导致它们被重新生成或轮换**（会让所有用户登出）。
- 可选配置（邮件 Key 等）通过控制台变量设置，部署使用 `--keep-vars` 保留；不要把配置写死在 `wrangler.toml` 的 `[vars]` 里。
- 前端与 API 同一个 Worker、同一域名：前端默认请求同源 `/api`，不要写死 API 地址。

## 前端

- 界面文字一律走 i18n（`apps/web/src/i18n/locales/zh.json` 与 `en.json`），**两个文件的 key 必须同时增删**，不要在组件里写死文字。
- 给用户的接入、配置指引做在系统界面里（分步向导、自动检测、可复制的代码），不要只写成仓库文档。

## 代码与提交

- 文档、代码注释用中文；标识符用英文。
- 提交信息格式：`type(scope): 描述`，type 用 `feat` / `fix` / `perf` / `refactor` / `docs` / `build` 等。
- 提交前运行：`pnpm -r typecheck` 和 `pnpm test`（在 Workers 运行时中跑，使用本地 D1）；涉及前端时再运行 `pnpm --filter web build`。
- 修改业务规则时同步补测试（`apps/workers/test/`）；以界面接口的现有行为为准，其它入口要与之一致。
- 改动保持聚焦：一个 PR 做一件事，不顺手重构无关代码。

## 排错

- 线上问题先看 `crm-dev` / 生产 Worker 的 Workers Logs（`wrangler.toml` 已开启 `[observability]`）。
- 通过 Cloudflare Observability MCP 查询时，用 `calculations` 视图（按 `$metadata.trigger`、`$metadata.message`、`$metadata.error` 分组计数）；`events` 视图目前会因响应解析失败而报错。
- 构建失败看 Workers Builds 的构建日志。
- 本地调试：`pnpm --filter workers dev`（需要 `apps/workers/.dev.vars`，示例见 DEPLOY.md）。Workers AI 绑定在本地也要连 Cloudflare，没有登录或 API Token 时 `wrangler dev` 会启动失败。
- 查询线上 D1 只用只读 SQL；任何写入、删除先征得用户同意。

## 关键决策（为什么这样做）

- **单 Worker 而非 Pages + Worker**：静态资源由 Worker Static Assets 免费提供，前后端同域名免去 CORS 和反向代理；旧方案保留在 tag `v1.0.0`。
- **Workers Builds 而非 GitHub Actions**：GitHub 中无需任何 Secret，资源名由 Worker 名自动推导，fork 即可部署。
- **PBKDF2 而非 bcryptjs**：bcryptjs 单次校验约 360ms CPU，超出 Workers 限制。
