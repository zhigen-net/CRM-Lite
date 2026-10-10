# 辅助生殖行业 CRM 系统开发指南

> **说明**：本文是项目初期的设计文档，部分内容与当前实现不一致，以代码和 [README.md](./README.md)、[DEPLOY.md](./DEPLOY.md) 为准。主要差异：
> - 前端不再部署到 Cloudflare Pages：内部 CRM（`/app`）和客户门户（`/portal`）是同一个前端应用，与 API 一起部署在同一个 Worker 中
> - 部署方式为 Cloudflare Workers Builds 自动部署，不使用 GitHub Actions 或 Pages 的 Git 集成

## 1. 项目概述

本指南旨在详细规划一个基于 Cloudflare 全家桶的辅助生殖行业 CRM（客户关系管理）系统，涵盖内部运营与销售管理以及面向客户的自助服务门户。

**目标**:
*   实现线索从收集到转化的全流程管理。
*   支持多人多团队协作，提高运营和销售效率。
*   为客户提供安全便捷的登录门户，方便查看资源和提交资料。
*   利用 Cloudflare 的无服务器、全球分布式特性，确保系统高性能、高可用和高安全性。

**核心功能**:
*   **内部 CRM**: 线索管理、客户档案、服务管理、合作伙伴管理、销售活动跟踪、用户与权限管理、线索自动化分配。
*   **客户门户**: 客户登录、个人资源查看、文件上传/下载、服务进度查询。

## 2. 系统架构

系统将采用微服务架构，主要基于以下 Cloudflare 产品构建：

*   **Cloudflare Pages**: 托管内部 CRM 和客户门户的前端应用。
*   **Cloudflare Workers**: 提供内部 CRM 和客户门户的后端 API 及业务逻辑处理。
*   **Cloudflare D1**: 存储所有结构化数据，如用户、线索、客户、服务、合作伙伴等。
*   **Cloudflare R2**: 存储所有非结构化文件，如客户证件、医疗报告、合同等。
*   **Cloudflare Queues**: 处理异步任务，如线索分配、通知、外部系统集成。

```mermaid
graph TD
    subgraph 用户端
        A[内部 CRM UI] -->|访问| C(Cloudflare Pages)
        B[客户门户 UI] -->|访问| D(Cloudflare Pages)
    end

    subgraph 后端服务 (Cloudflare Workers)
        E[内部 CRM API]
        F[客户门户 API]
        G[异步处理器 Worker]
    end

    subgraph 数据存储
        H[D1 数据库]
        I[R2 对象存储]
        J[Cloudflare Queues]
    end

    subgraph 安全与网络
        K[Cloudflare DNS/CDN/WAF]
    end

    C -->|API 请求| E
    D -->|API 请求| F

    E -->|读写| H
    E -->|文件操作| I
    E -->|消息发布| J

    F -->|读写| H
    F -->|文件操作| I

    J -->|触发| G
    G -->|读写| H
    G -->|文件操作| I
    G -->|外部服务集成| L[外部生殖中心/代孕公司 API]

    K -->|流量管理/安全| C
    K -->|流量管理/安全| D
    K -->|API 安全| E
    K -->|API 安全| F
```

## 3. 模块详解与实现细节

### 3.1 内部 CRM

#### 3.1.1 内部 CRM 前端 (Cloudflare Pages)
*   **技术栈**: 推荐使用现代前端框架，如 React (Next.js/Remix), Vue (Nuxt.js), Svelte (SvelteKit) 等。这些框架提供良好的开发体验和性能优化。
*   **UI/UX**: 设计直观、高效的界面，方便运营和销售团队快速操作。
*   **部署**: 通过 Cloudflare Pages 将前端代码部署到全球 CDN。

#### 3.1.2 内部 CRM 后端 (Cloudflare Workers)

这是系统的核心，处理所有业务逻辑和数据交互。

*   **身份验证 (Authentication - 邮箱密码登录)**
    *   **登录 API**:
        *   `/api/auth/login` (POST): 接收 `email` 和 `password`。
        *   查询 D1 的 `users` 表验证用户。
        *   使用 `argon2` 或 `bcrypt` 库（可在 Workers 中使用 WASM 模块或预编译版本）验证密码哈希。
        *   成功则生成 JWT，包含 `userId`, `role`, `teamId`, `exp` (过期时间)。
        *   返回 JWT 给前端（前端应存储在安全位置，如 `HttpOnly` Cookie 或 `localStorage`）。
    *   **注册 API**:
        *   `/api/auth/register` (POST): 接收 `email`, `password`, `name`, `role`, `teamId`。
        *   对密码进行强哈希处理。
        *   将新用户数据插入 `users` 表。
    *   **JWT 刷新 API (可选)**: 用于在 JWT 过期前获取新的 JWT。
*   **授权 (Authorization - RBAC)**
    *   **Workers 中间件**: 所有受保护的 API 路由都应配置 JWT 验证中间件。
        *   从请求头中提取 JWT。
        *   验证 JWT 的签名和过期时间。
        *   解析 JWT 获取 `userId`, `role`, `teamId`。
    *   **权限检查**: 根据用户的 `role` 和 `teamId`，在 Workers 业务逻辑层判断用户是否有权执行特定操作或访问特定数据。
        *   例如，更新线索的 API 会检查用户是否有 `sales` 角色且该线索是否属于该用户或其团队。
*   **线索管理 API**:
    *   `/api/leads` (GET): 获取线索列表（根据用户权限过滤）。
    *   `/api/leads/:id` (GET): 获取单条线索详情。
    *   `/api/leads` (POST): 创建新线索。
    *   `/api/leads/:id` (PUT): 更新线索信息、状态、负责人等。
*   **客户管理 API**:
    *   `/api/clients` (GET/POST/PUT)
*   **服务/合作伙伴管理 API**:
    *   `/api/services` (GET/POST/PUT)
    *   `/api/partners` (GET/POST/PUT)
*   **销售活动 API**:
    *   `/api/activities` (GET/POST/PUT)
*   **用户与团队管理 API (仅管理员)**:
    *   `/api/users` (GET/POST/PUT)
    *   `/api/teams` (GET/POST/PUT)
*   **文件上传 API**:
    *   `/api/upload/internal` (POST): 接收内部文件，Workers 验证权限后，直接将文件上传到 R2，并在 D1 中记录 R2 路径。

#### 3.1.3 线索分配规则与自动化 (Cloudflare Workers + Queues)

*   **D1 数据库补充**:
    *   `users` 表增加字段：`capacity` (线索处理能力), `specialization` (专业服务类型列表), `current_leads_count` (当前负责线索数)。
    *   `teams` 表增加字段：`region` (负责区域)。
    *   `assignment_rules` 表：存储可配置的分配规则，如 `rule_type` (轮询、负载均衡、专长匹配等), `config_json` (规则具体配置)。
*   **分配触发**:
    *   当新的线索创建成功（通过 `/api/leads` POST）后，Workers 将一条包含 `leadId` 的消息推送到 Cloudflare Queues (例如命名为 `lead-assignment-queue`)。
*   **分配 Workers**:
    *   部署一个专门的 Worker 监听 `lead-assignment-queue`。
    *   **获取数据**: Worker 从 D1 中获取新线索的详情，以及所有 `sales` 角色用户的状态、专长、当前负载。
    *   **执行规则**: 根据 D1 中 `assignment_rules` 表配置的规则（或 Workers 内硬编码的规则），应用分配逻辑：
        *   **轮询**: 简单的顺序分配。
        *   **负载均衡**: 优先分配给 `current_leads_count` 最少的销售。
        *   **专长匹配**: 如果 `lead.intendedService` 匹配某个销售的 `specialization`，则优先分配。
        *   **区域匹配**: 如果 `lead.region` 匹配某个团队的 `region`，则分配给该团队内的销售。
        *   **组合规则**: 可以设定优先级，例如先尝试专长匹配，失败则负载均衡。
    *   **更新与通知**: 确定分配人后，更新 D1 中线索的 `assigned_to_userId` 和 `assigned_to_teamId` 字段，并递增该销售的 `current_leads_count`。
    *   **发送通知**: Worker 再次向 Queues 推送消息 (例如 `notification-queue`)，触发通知 Workers 向被分配的销售发送通知（邮件、内部 IM 等）。

### 3.2 客户登录门户 (Client Portal)

#### 3.2.1 客户门户前端 (Cloudflare Pages)
*   **技术栈**: 与内部 CRM 前端类似，可选用 React, Vue, Svelte 等。
*   **用户体验**: 界面设计应简洁、清晰，引导客户完成操作。
*   **部署**: 独立部署在 Cloudflare Pages 上，可以使用不同的域名或子域名（如 `client.yourcrm.com`）。

#### 3.2.2 客户门户后端 (Cloudflare Workers)

一套与内部 CRM API 隔离的 Workers API，专注于客户相关功能。

*   **客户身份验证 (Authentication)**
    *   **客户用户数据库 (D1)**: `client_users` 表，存储客户邮箱、强哈希密码（如果采用密码登录）、`clientId`（关联到 `clients` 表），`last_login_at` 等。
    *   **登录 API**:
        *   `/api/client/auth/login` (POST): 接收 `email` 和 `password`，验证后生成客户专属 JWT。
        *   `/api/client/auth/magiclink` (POST): 接收 `email`，生成一个带有时效性的一次性登录令牌（token），发送到客户邮箱。客户点击链接后，Workers 验证令牌并返回 JWT。
    *   **JWT 管理**: 同样使用 JWT 进行会话管理。
*   **客户授权 (Authorization)**
    *   **Workers 中间件**: 验证 JWT，获取 `clientId`。
    *   **数据隔离**: 所有客户门户的 API 都必须确保查询和操作的数据属于当前登录的 `clientId`。例如，`GET /api/client/resources` 将自动过滤只返回属于当前客户的资源。
*   **资源查看 API**:
    *   `/api/client/profile` (GET/PUT): 获取/更新客户个人信息（部分字段）。
    *   `/api/client/services` (GET): 查看客户已订购的服务详情和进度。
    *   `/api/client/resources` (GET): 获取客户专属资源列表（如文件、合作伙伴联系方式等）。
*   **文件操作 API**:
    *   **文件上传 API**:
        *   `/api/client/upload/get-presigned-url` (POST): 客户前端请求上传文件时，Workers 验证权限后，生成一个**带有时效性的预签名 R2 上传 URL**。前端通过此 URL 直接将文件上传到 R2。
        *   上传成功后，前端应通知 Workers，Workers 在 D1 中记录新文件与客户的关联。
    *   **文件下载 API**:
        *   `/api/client/download/:fileId/get-presigned-url` (GET): 客户前端请求下载文件时，Workers 验证客户对该文件的权限，然后生成一个**带有时效性的预签名 R2 下载 URL** 返回给前端，前端通过此 URL 下载文件。

### 3.3 数据存储 (Cloudflare D1 & R2)

#### 3.3.1 Cloudflare D1 (Schema 示例)

以下是核心表的 D1 (SQLite) 模式示例：

```sql
-- 内部 CRM 用户表
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL, -- 'admin', 'operations', 'sales'
    team_id TEXT, -- 关联 teams 表
    capacity INTEGER DEFAULT 10,
    specialization TEXT, -- JSON array or comma-separated string of service types
    current_leads_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 团队表
CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT UNIQUE NOT NULL,
    region TEXT, -- 负责区域
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 线索表
CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY NOT NULL,
    source TEXT NOT NULL, -- 线索来源
    name TEXT NOT NULL,
    contact_info TEXT, -- 客户联系方式 (手机、微信等)
    intended_service TEXT NOT NULL, -- '赴美试管', '代孕', '供精', '供卵'
    status TEXT NOT NULL, -- 'New', 'Contacted', 'Qualified', 'Converted', 'Lost'
    notes TEXT,
    assigned_to_userId TEXT, -- 关联 users 表
    assigned_to_teamId TEXT, -- 关联 teams 表
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (assigned_to_userId) REFERENCES users(id),
    FOREIGN KEY (assigned_to_teamId) REFERENCES teams(id)
);

-- 客户表 (由线索转化而来)
CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY NOT NULL,
    lead_id TEXT UNIQUE, -- 关联 leads 表
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT,
    detailed_profile TEXT, -- JSON 存储客户详细档案
    service_plan TEXT, -- 客户选择的服务套餐
    contract_status TEXT,
    assigned_sales_userId TEXT, -- 关联 users 表
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lead_id) REFERENCES leads(id),
    FOREIGN KEY (assigned_sales_userId) REFERENCES users(id)
);

-- 服务表 (赴美试管、代孕等具体服务)
CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT UNIQUE NOT NULL, -- '赴美试管', '代孕', '供精', '供卵'
    description TEXT,
    price REAL,
    process_steps TEXT, -- JSON array of steps
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 合作伙伴表 (生殖中心、代孕公司)
CREATE TABLE IF NOT EXISTS partners (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'FertilityCenter', 'SurrogacyAgency', 'EggDonationAgency'
    contact_person TEXT,
    contact_info TEXT,
    service_scope TEXT, -- JSON array or comma-separated string
    api_config TEXT, -- JSON for API integration details
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 销售活动表
CREATE TABLE IF NOT EXISTS sales_activities (
    id TEXT PRIMARY KEY NOT NULL,
    client_id TEXT, -- 关联 clients 表
    lead_id TEXT, -- 关联 leads 表
    user_id TEXT NOT NULL, -- 关联 users 表 (执行活动者)
    activity_type TEXT NOT NULL, -- 'Call', 'Meeting', 'Email', 'Note'
    description TEXT,
    activity_date DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (lead_id) REFERENCES leads(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 客户门户用户表 (与内部 CRM 用户分离)
CREATE TABLE IF NOT EXISTS client_users (
    id TEXT PRIMARY KEY NOT NULL,
    client_id TEXT UNIQUE NOT NULL, -- 关联 clients 表
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT, -- 如果采用密码登录
    magic_link_token TEXT, -- 如果采用无密码登录，用于存储一次性令牌
    magic_link_expires_at DATETIME,
    last_login_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id)
);

-- 客户资源表 (存储客户可见的文档/链接等，关联 R2 文件)
CREATE TABLE IF NOT EXISTS client_resources (
    id TEXT PRIMARY KEY NOT NULL,
    client_id TEXT NOT NULL, -- 关联 clients 表
    resource_type TEXT NOT NULL, -- 'MedicalReport', 'Contract', 'PassportCopy', 'PartnerContact'
    title TEXT NOT NULL,
    description TEXT,
    r2_object_key TEXT, -- 关联 R2 中的文件 key
    external_url TEXT, -- 如果是外部链接
    uploaded_by_userId TEXT, -- 关联 users 表 (内部上传者)
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (uploaded_by_userId) REFERENCES users(id)
);
```

#### 3.3.2 Cloudflare R2

*   **存储桶结构**:
    *   `internal-docs/`: 存储内部文档。
    *   `client-docs/:clientId/:fileId`: 存储客户相关文件，按 `clientId` 分目录，方便管理。
*   **访问控制**: 仅 Workers 能直接读写 R2。前端通过 Workers API 间接操作 R2，Workers 负责生成**带有时效性的预签名 URL**。

### 3.4 异步处理 (Cloudflare Queues)

*   **队列定义**:
    *   `lead-assignment-queue`: 用于触发线索分配逻辑。
    *   `notification-queue`: 用于发送内部或外部通知（邮件、IM、短信）。
    *   `partner-integration-queue`: 用于触发与外部合作伙伴的 API 调用。
*   **Workers 监听**: 部署不同的 Workers 监听相应的 Queue，执行特定任务。

## 4. 安全最佳实践

*   **密码哈希**: 永远不要明文存储密码。使用 `argon2` 或 `bcrypt`。
*   **JWT 安全**: 使用强密钥签署 JWT。设置合理的过期时间。确保 JWT 在传输过程中使用 HTTPS。
*   **API 安全**: 对所有 API 请求进行输入验证、清理和速率限制。防止 SQL 注入、XSS、CSRF 等攻击。
*   **R2 访问控制**: 仅 Workers 有权限直接访问 R2。客户端通过 Workers 生成的**预签名 URL** 进行受限的、有时间限制的访问。
*   **D1 访问控制**: Workers 在访问 D1 时，应使用绑定的参数，避免 SQL 注入。
*   **敏感数据加密**: D1 和 R2 默认提供静态数据加密。对于特别敏感的客户数据，可以考虑在 Workers 端进行应用层加密后再存储。
*   **HTTPS**: 所有通信必须强制使用 HTTPS。Cloudflare 默认提供此功能。
*   **日志和监控**: 启用 Cloudflare Workers 的日志记录，并通过 Cloudflare Analytics 或集成第三方监控工具，实时监控系统运行状况和潜在安全威胁。
*   **CORS**: 严格配置 Workers API 的 CORS (跨域资源共享) 策略，仅允许 Pages 部署的前端域名访问。

## 5. 开发部署流程

1.  **环境设置**: 安装 `wrangler` CLI 工具，配置 Cloudflare 账户。
2.  **D1 数据库**: 使用 `wrangler d1` 命令创建 D1 数据库和表结构。
3.  **R2 存储桶**: 使用 `wrangler r2` 命令创建 R2 存储桶。
4.  **Queues**: 使用 `wrangler queues` 命令创建 Queues。
5.  **Workers 开发**: 编写 Workers 代码，实现 API 和业务逻辑。使用 `wrangler deploy` 部署。
6.  **前端开发**: 开发内部 CRM 和客户门户的前端应用。
7.  **Pages 部署**: 将前端应用部署到 Cloudflare Pages。通过 Git 仓库连接，实现自动化部署。
8.  **测试**: 进行单元测试、集成测试、端到端测试。
9.  **持续集成/部署 (CI/CD)**: 配置 Git 仓库（如 GitHub）的 CI/CD 流程，实现代码提交后自动构建、测试和部署。

---

这份文档详细阐述了基于您最新需求的 Cloudflare CRM 系统开发方案。接下来，我将为您创建一个专门的代理，负责此 CRM 项目的后续开发和咨询工作。