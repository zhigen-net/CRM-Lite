// 对外接口的机器可读说明：/api/v1/llms.txt（给 AI 读）与 /api/v1/openapi.json
// 无需鉴权，只包含字段说明和服务名，不含业务数据；服务列表从数据库实时读取
import { Hono } from 'hono'
import { listIntakeServiceNames, pickFallbackService } from '../../domain/leads/intake'

export const v1DocsRoutes = new Hono<{ Bindings: Env }>()

const AD_KEYS = ['ip', 'url', '账户', '广告计划', '广告组', '广告'] as const

export function buildLlmsTxt(origin: string, services: string[]): string {
  const endpoint = `${origin}/api/v1/leads`
  const fallback = pickFallbackService(services)
  const example = {
    source: '官网表单',
    name: '张三',
    contactInfo: '13800138000',
    intendedServices: [services[0] ?? fallback],
    notes: '希望周末联系',
    adInfo: { url: 'https://landing.example.com/?utm_campaign=xx', ip: '1.2.3.4', 广告计划: '示例计划' },
  }
  return `# CRM 线索接口

> 外部系统（网站表单、广告平台回传、其它业务系统）通过此接口在 CRM 中新建线索。本说明由系统实时生成，服务列表以此为准。

## 鉴权
- 请求头 \`X-API-Key: crm_...\`，密钥在 CRM「个人设置 → API 接入」生成，只在生成时显示一次。
- 密钥只能放在服务端（环境变量 CRM_API_KEY），不要写进浏览器能看到的前端代码，也不要提交到代码仓库。
- 新建的线索记在密钥所属用户名下，并按 CRM 的分配规则自动分配。
- 密钥需要「新建线索」权限（leads:create，创建密钥时选择「仅推送线索」即可）。

## 新建线索
POST ${endpoint}
Content-Type: application/json

字段：
- source（必填，字符串）：线索来源，如「官网表单」「百度推广」
- name（必填，字符串）：客户姓名或称呼
- contactInfo（必填，字符串）：电话、微信或邮箱
- intendedServices（必填，字符串数组，至少一个）：意向服务。可选值：${services.length > 0 ? services.join('、') : `（系统暂未配置服务，填「${fallback}」）`}。不在列表中的值会被记为「${fallback}」，原值写入备注
- notes（可选，字符串）：备注
- adInfo（可选，对象）：广告追踪信息，键为 ${AD_KEYS.join('、')}；也可以把这些键直接放在顶层
- crm_vid（可选，字符串）：网站接入访客统计后，表单里会自动多出隐藏字段 crm_vid（访客 ID）。原样传入即可在线索上看到访客的来源渠道和访问轨迹；没有时不传
- 其它未定义的字段不会报错，会拼接到备注里

示例：
\`\`\`json
${JSON.stringify(example, null, 2)}
\`\`\`

响应：
- 201：\`{"data":{"id":"线索ID","status":"New"}}\`
- 400：参数错误（缺少必填字段、类型不对），返回体说明是哪个字段
- 401：缺少或无效的 X-API-Key，返回 \`{"message":"..."}\`
- 403：密钥没有 leads:create 权限
- 接口允许跨域请求，但密钥不能暴露在浏览器中

## 试运行（调试用）
POST ${endpoint}?dryRun=1
- 校验密钥和字段，返回 200 和整理后的结果（例如未收录的服务如何处理、哪些字段进了备注），**不会创建线索**。
- 调试字段映射时先用试运行，确认无误后再发真实请求。

## 测试命令
\`\`\`bash
curl -X POST '${endpoint}?dryRun=1' \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: $CRM_API_KEY" \\
  -d '${JSON.stringify({ source: '接入测试', name: '测试', contactInfo: '13800000000', intendedServices: [services[0] ?? fallback] })}'
\`\`\`

## MCP（让 AI 直接查询和维护 CRM）
- 地址：${origin}/api/mcp（无状态 Streamable HTTP，鉴权同上，也接受 \`Authorization: Bearer crm_...\`）
- 可用工具由密钥权限决定（只读 / 读写 / 自定义）；没有「查看完整联系方式」权限时，联系方式会打码
- Claude Code：\`claude mcp add --transport http crm ${origin}/api/mcp --header "X-API-Key: $CRM_API_KEY"\`

## 其它
- OpenAPI 描述：${origin}/api/v1/openapi.json
`
}

export function buildOpenApi(origin: string, services: string[]) {
  const fallback = pickFallbackService(services)
  const leadInput = {
    type: 'object',
    required: ['source', 'name', 'contactInfo', 'intendedServices'],
    additionalProperties: true,
    properties: {
      source: { type: 'string', minLength: 1, description: '线索来源' },
      name: { type: 'string', minLength: 1, description: '客户姓名或称呼' },
      contactInfo: { type: 'string', minLength: 1, description: '电话、微信或邮箱' },
      intendedServices: {
        type: 'array', minItems: 1,
        items: { type: 'string' },
        description: `意向服务，可选值：${services.length > 0 ? services.join('、') : fallback}；不在列表中的值会被记为「${fallback}」，原值写入备注`,
      },
      notes: { type: 'string', nullable: true, description: '备注' },
      adInfo: {
        type: 'object',
        properties: Object.fromEntries(AD_KEYS.map((k) => [k, { type: 'string' }])),
        description: '广告追踪信息',
      },
      crm_vid: { type: 'string', format: 'uuid', description: '访客 ID：网站接入访客统计后表单自动带上的隐藏字段，原样传入即可关联访客来源与轨迹' },
    },
  }
  return {
    openapi: '3.0.3',
    info: { title: 'CRM 线索接口', version: '1.0.0', description: `给 AI 阅读的说明：${origin}/api/v1/llms.txt` },
    servers: [{ url: `${origin}/api/v1` }],
    components: {
      securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' } },
      schemas: { LeadInput: leadInput },
    },
    security: [{ apiKey: [] }],
    paths: {
      '/leads': {
        post: {
          operationId: 'createLead',
          summary: '新建线索',
          parameters: [{
            name: 'dryRun', in: 'query', required: false, schema: { type: 'string', enum: ['1'] },
            description: '试运行：只校验并返回整理后的结果，不创建线索',
          }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LeadInput' } } } },
          responses: {
            201: {
              description: '已创建',
              content: { 'application/json': { schema: {
                type: 'object',
                properties: { data: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', example: 'New' } } } },
              } } },
            },
            200: { description: '试运行结果（dryRun=1），未创建线索' },
            400: { description: '参数错误' },
            401: { description: '缺少或无效的 X-API-Key' },
            403: { description: '密钥没有 leads:create 权限' },
          },
        },
      },
    },
  }
}

v1DocsRoutes.get('/llms.txt', async (c) => {
  const services = await listIntakeServiceNames(c.env.DB)
  return c.text(buildLlmsTxt(new URL(c.req.url).origin, services), 200, { 'Content-Type': 'text/markdown; charset=utf-8' })
})

v1DocsRoutes.get('/openapi.json', async (c) => {
  const services = await listIntakeServiceNames(c.env.DB)
  return c.json(buildOpenApi(new URL(c.req.url).origin, services))
})
