// 站点的部署平台、功能开关、平台识别与接入模板
import { beforeAll, describe, expect, it } from 'vitest'
import { detectFromHeaders, platformTemplates, PLATFORMS, PROXY_SPEC } from '../src/domain/tracking/platforms'
import { api, createUser, type TestUser } from './helpers'

let admin: TestUser, ops: TestUser
let siteId: string

beforeAll(async () => {
  admin = await createUser('admin')
  ops = await createUser('operations')
  siteId = ((await (await api(admin, 'POST', '/api/admin/tracking-sites', { name: '平台测试站' })).json()) as { data: { id: string } }).data.id
})

describe('部署平台与功能开关', () => {
  it('默认没有平台、表单关闭；可设置平台和功能；平台值必须有效', async () => {
    const get = async () => ((await (await api(admin, 'GET', `/api/admin/tracking-sites/${siteId}`)).json()) as { data: { platform: string | null; features: { forms: boolean } } }).data
    expect(await get()).toMatchObject({ platform: null, features: { forms: false, connect: 'url' } })
    expect((await api(admin, 'PATCH', `/api/admin/tracking-sites/${siteId}`, { platform: 'vercel', features: { forms: true } })).status).toBe(200)
    expect(await get()).toMatchObject({ platform: 'vercel', features: { forms: true } })
    expect((await api(admin, 'PATCH', `/api/admin/tracking-sites/${siteId}`, { platform: 'mars' })).status).toBe(400)
    expect((await api(ops, 'GET', `/api/admin/tracking-sites/${siteId}`)).status).toBe(403)
  })

  it('接入模板接口返回各平台的文件与转发协议', async () => {
    const { data } = (await (await api(admin, 'GET', '/api/admin/tracking-sites/integration')).json()) as { data: { platforms: Record<string, { path: string; code: string }[]>; proxySpec: string } }
    expect(Object.keys(data.platforms).sort()).toEqual([...PLATFORMS].sort())
    expect(data.proxySpec).toContain('X-Site-Key')
  })
})

describe('各平台模板', () => {
  const templates = platformTemplates()
  it('有模板的平台都转发到 /api/t/、带站点密钥和访客 IP，且不写死 CRM 地址或密钥', () => {
    for (const p of PLATFORMS.filter((x) => x !== 'other' && x !== 'static')) {
      const code = templates[p].map((f) => f.code).join('\n')
      expect(code, p).toMatch(/\/api\/t/)
      expect(code, p).toMatch(/X-Site-Key/)
      expect(code, p).toMatch(/ip/)
      expect(code, p).not.toMatch(/cts_[0-9a-f]{8}/)
      expect(code, p).not.toMatch(/https:\/\/[a-z0-9.-]+\.(com|cn|dev)\b/)
    }
    expect(PROXY_SPEC).toContain('/_t/lead')
  })
  it('服务器配置类模板用占位符写 CRM 地址，由界面替换', () => {
    expect(templates.nginx[0]!.code).toContain('{{CRM_URL}}/api/t/')
    expect(templates.php.find((f) => f.path.endsWith('config.php'))!.code).toContain('{{CRM_URL}}')
  })
})

describe('识别部署平台', () => {
  const H = (h: Record<string, string>) => new Headers(h)
  it('按响应头识别常见平台', () => {
    expect(detectFromHeaders(H({ 'x-vercel-id': 'hkg1::abc', server: 'Vercel' })).platform).toBe('vercel')
    expect(detectFromHeaders(H({ 'x-nf-request-id': 'x', server: 'Netlify' })).platform).toBe('netlify')
    expect(detectFromHeaders(H({ 'eo-log-uuid': 'x' })).platform).toBe('edgeone_pages')
    expect(detectFromHeaders(H({ server: 'GitHub.com', 'x-github-request-id': 'x' })).platform).toBe('static')
    expect(detectFromHeaders(H({ 'x-oss-request-id': 'x', server: 'AliyunOSS' })).platform).toBe('static')
    expect(detectFromHeaders(H({ 'cf-ray': 'x', server: 'cloudflare' }))).toMatchObject({ platform: 'cloudflare_pages', behindCloudflare: true })
    expect(detectFromHeaders(H({ server: 'nginx/1.24' })).platform).toBe('nginx')
    expect(detectFromHeaders(H({ server: 'Apache', 'x-powered-by': 'PHP/8.2' })).platform).toBe('php')
    expect(detectFromHeaders(H({ 'x-powered-by': 'Express' })).platform).toBe('node')
    expect(detectFromHeaders(H({})).platform).toBeNull()
  })
  it('识别接口只有管理员可用，域名不合法时 400', async () => {
    expect((await api(ops, 'POST', '/api/admin/tracking-sites/detect', { domain: 'example.com' })).status).toBe(403)
    expect((await api(admin, 'POST', '/api/admin/tracking-sites/detect', { domain: '127.0.0.1' })).status).toBe(400)
  })
})
