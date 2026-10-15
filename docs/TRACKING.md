# 网站接入访客统计

本文说明如何把部署在 Cloudflare Pages 或 Workers 上的网站接入 CRM 的「访客分析」。每个网站按下面的步骤操作一次。接入多个网站时，逐个重复即可。

## 工作原理

```
浏览器 ──▶ 网站自己的 /_t/*  ──(服务器端转发，带站点密钥)──▶ CRM 的 /api/t/*
          （同域名，看不到 CRM）    Pages Function / Worker          校验密钥后写入
```

- 浏览器只请求网站自己域名下的 `/_t/t.js`（采集脚本）和 `/_t/collect`（上报）。网站前端里**不会出现 CRM 地址和任何密钥**。
- 网站的 Pages Function 或 Worker 在服务器端把请求转发给 CRM，并带上以下信息：
  - 站点密钥：加密环境变量 `CRM_SITE_KEY`；
  - 访客的地区和运营商：从 Cloudflare 的 `request.cf` 读取。
- CRM 的 `/api/t/*` 不开放跨域，只接受带有效站点密钥的请求。CRM 只保存 IP 的哈希值，不保存原始 IP。

## 准备

1. **选择接入哪个 CRM 环境。** 测试环境（`dev` 分支对应的 Worker）和生产环境的数据互相独立，站点密钥也不通用。建议先接测试环境，验证通过后，再在生产 CRM 新建站点并换成生产的密钥。
2. **确认网站与 CRM 是否在同一个 Cloudflare 账号下。** 这决定网站用哪种方式连接 CRM：

   | 情况 | 连接方式 | 网站需要配置 |
   |---|---|---|
   | 同一账号（推荐） | 服务绑定：请求走 Cloudflare 内部，不经过公网 | Secret `CRM_SITE_KEY` 和服务绑定 `CRM` |
   | 不同账号 | 通过公网地址访问 | Secret `CRM_SITE_KEY` 和 Secret `CRM_URL` |

   `CRM_URL` 填 CRM 的访问地址，例如 `https://crm.example.com`，**末尾不要加 `/`**。它存放在 Secret 里，浏览器看不到。

3. 在 CRM 中操作需要管理员账号。

## 接入步骤（每个网站一次）

### 第 1 步：在 CRM 添加站点，复制密钥

1. 打开 CRM 左侧导航「访客分析」，切换到「站点管理」，点「添加站点」。
2. 填写站点名称（如「官网」「活动落地页」），域名可以不填。
3. 创建后会弹出接入窗口，**立即复制站点密钥**（`cts_` 开头）。密钥只显示这一次。
   - 如果丢失了密钥，点「更换密钥」生成新的。旧密钥会立即失效，网站的 `CRM_SITE_KEY` 需要同步更新。
4. 接入窗口里有 Pages / Worker 两种转发代码、脚本标签，以及可以直接交给 AI 的接入提示词。之后在站点卡片上点「接入代码」可以再次打开。

### 第 2 步：在网站项目里配置变量和绑定

在 Cloudflare 控制台打开**网站**所在的项目（不是 CRM 的 Worker）：Workers & Pages → 网站项目 → Settings。

1. **Variables and Secrets** → Add：
   - 类型选 **Secret**，名称 `CRM_SITE_KEY`，值填第 1 步复制的密钥。
   - 不同账号时，再添加 Secret `CRM_URL`。
2. 同一账号时，在 **Bindings** → Add → **Service binding** 中添加服务绑定：
   - Variable name 填 `CRM`（必须大写，与代码一致）；
   - Service 选择 CRM 的 Worker。接测试环境就选测试 Worker，接生产环境就选生产 Worker。
3. Pages 项目的变量和绑定分为 **Production** 和 **Preview** 两套，至少要在 Production 中配置。如果预览环境也要统计，就在 Preview 中也配置一遍。

> 配置变量和绑定后需要**重新部署**网站才会生效（见第 5 步）。

### 第 3 步：加入转发代码

转发代码可以从 CRM 接入窗口复制。不要修改其中的转发逻辑。

**Pages 网站**

- 在项目根目录（与构建输出目录同级，不是放在 `dist/` 或 `public/` 里）新建文件 `functions/_t/[[path]].js`，粘贴「Pages 网站」的转发代码。
- 如果项目自定义了 `_routes.json`，要确认 `/_t/*` 在 `include` 中、不在 `exclude` 中。否则请求不会进入 Function。
- 如果网站使用 Pages 的「高级模式」（构建输出中有 `_worker.js`），`functions/` 目录不会生效。这种情况请按下面「Worker 网站」的方式，把代码加进 `_worker.js`。
- Next.js、Nuxt 等框架通过适配器部署到 Pages 时，通常也会生成 `_worker.js`，处理方式相同。

**Worker 网站**

1. 把「Worker 网站」的转发代码（`forwardToCrm` 函数）粘贴进 Worker 入口文件。
2. 在 `fetch` 入口的**最前面**加上：

   ```js
   if (new URL(request.url).pathname.startsWith('/_t/')) return forwardToCrm(request, env)
   ```

3. 如果 Worker 带有静态资源（`wrangler.toml` 中有 `[assets]`），默认会优先返回静态文件。单页应用（`not_found_handling = "single-page-application"`）还会把 `/_t/t.js` 当成页面返回 `index.html`。因此需要让 `/_t/*` 先进入 Worker：

   ```toml
   [assets]
   # ……原有配置
   run_worker_first = ["/_t/*"]
   ```

   使用 `wrangler.jsonc` 时，写法为 `"run_worker_first": ["/_t/*"]`。

4. 同一账号时，服务绑定也可以写在网站的 wrangler 配置里，效果与控制台配置相同：

   ```toml
   [[services]]
   binding = "CRM"
   service = "<CRM Worker 名>"
   ```

### 第 4 步：在页面中加入脚本标签

在网站**每个页面**的 `</head>` 前加上：

```html
<script src="/_t/t.js" defer></script>
```

- 静态站点：加在公共布局或模板中。
- 单页应用：加在 `index.html` 中即可。路由切换会自动记为新的浏览。

### 第 5 步：重新部署

推送代码，或在控制台重新部署。改动了变量或绑定、但代码没有变化时，也要重新部署一次。

### 第 6 步：验证

1. 打开网站，在浏览器开发者工具的 Network 面板中确认：
   - `/_t/t.js` 返回 200，并且内容是 JavaScript，不是 HTML 页面；
   - `/_t/collect` 返回 **204**。
2. 回到 CRM「访客分析 → 站点管理」，确认该站点显示「最近数据 刚刚」。在「访客」页能看到这次访问。
3. 可以在网址后面加上 `?utm_source=test&utm_medium=cpc` 再访问一次，检查「首次来源」是否识别为「广告」。注意：同一个访客的首次来源只记录第一次的来源。如果想重新测试首次来源，请改用无痕窗口。

## 接入多个网站

- **每个网站在 CRM 中新建一个站点，使用独立的密钥。** 这样数据可以按站点区分，单个网站的密钥泄露时，只需更换这一把。
- 访客 ID 按域名保存在浏览器中，所以同一个人访问两个不同域名，会被记为两个访客。
- 同一个域名下的多个页面或子路径（如 `/landing/a`、`/landing/b`）属于同一个站点，不需要分别接入。按落地页区分来源请使用 UTM 参数。
- 多个网站共用同一份转发代码，区别只在各自项目中的 `CRM_SITE_KEY`。
- 批量接入时，可以把每个站点接入窗口里的「交给 AI 的接入提示词」分别交给编码 AI，在各自的网站仓库中执行。密钥仍由你在控制台手动填写，不要发给 AI，也不要写进代码仓库。
- 测试环境验证通过后切换到生产环境：在生产 CRM 新建同名站点，把网站的 `CRM_SITE_KEY` 换成生产密钥，再把服务绑定 `CRM` 改为指向生产 Worker（不同账号时改 `CRM_URL`），然后重新部署。

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| `/_t/collect` 返回 401 | 站点密钥不对，或站点已在 CRM 中停用。也可能是变量配在了 Preview 而不是 Production，或者配置后没有重新部署。还要注意密钥必须与所接入的 CRM 环境一致：测试环境的密钥不能用于生产环境。 |
| `/_t/t.js` 返回 HTML 页面 | 请求没有进入转发代码。Pages 网站请检查 `functions/` 的路径和 `_routes.json`；Worker 网站请检查 `run_worker_first`，以及入口中的判断是否放在最前面。 |
| `/_t/*` 返回 404 | Pages 网站的 `functions/_t/[[path]].js` 路径或文件名不对（文件名包含两层方括号），或者项目处于高级模式（`_worker.js`），`functions/` 不生效。 |
| `/_t/*` 返回 500 | 服务绑定 `CRM` 和 `CRM_URL` 都没有配置；或者 `CRM_URL` 写错了，比如末尾多了 `/` 或缺少 `https://`。在网站项目的 Workers Logs 中可以看到具体错误。 |
| 返回 204，但 CRM 中没有数据 | CRM 会过滤爬虫和自动化浏览器（如 Playwright、Selenium），所以请用正常浏览器测试。另外，部分广告拦截插件会拦截统计请求，测试时请关闭插件。 |
| 表单后端报错，提示有未知字段 | 采集脚本会在表单中加入隐藏字段 `crm_vid`（访客 ID），用于以后把线索与访客关联。CRM 的线索接口会忽略这个字段；如果第三方表单后端校验严格，请让它忽略 `crm_vid`。 |
| 网站有 CSP（内容安全策略） | 脚本和上报请求都是同源的，`script-src 'self'` 和 `connect-src 'self'` 即可，不需要放行 CRM 域名。 |

## 采集的数据与隐私

- **访问信息**：
  - 落地页、来源网址；
  - UTM 参数，以及广告点击 ID（`bd_vid`、`gdt_vid`、`clickid`、`gclid` 等，用来判断「广告」渠道）；
  - 设备、系统、浏览器，能识别微信等 App 内置浏览器；
  - 屏幕尺寸、语言、网络类型；
  - 地区与运营商。
- **行为**：浏览、离开（含停留时长和滚动深度）、点击电话链接、复制微信号、提交表单。
- **自定义事件**：网站可以调用 `window.__crmTracker.track('事件名', { ... })` 上报。
- **不保存的数据**：原始 IP（只保存哈希值），以及表单中填写的内容。
- 建议在网站的隐私政策中说明使用了访问统计。

## 当前限制

- 访客与线索的自动关联（留资后在访客轨迹中显示对应线索）还在开发中。
- 目前没有汇总报表（渠道、页面统计）。「访客」页按访客列出明细和访问轨迹。
