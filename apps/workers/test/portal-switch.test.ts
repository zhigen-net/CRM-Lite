// 客户门户开关：默认关闭，未开启时 /api/client/* 一律 404；不影响 /api/clients
import { exports } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { api, createUser, type TestUser } from './helpers'

let admin: TestUser
const portalLogin = () => exports.default.fetch('http://crm.test/api/client/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nobody@example.com', password: 'x' }),
})
const publicSettings = async () =>
  ((await (await exports.default.fetch('http://crm.test/api/public/settings')).json()) as { data: { portalEnabled: boolean } }).data

beforeAll(async () => { admin = await createUser('admin') })

describe('客户门户开关', () => {
  it('默认关闭：门户接口 404，公开设置里 portalEnabled=false', async () => {
    await api(admin, 'PUT', '/api/admin/settings', { portal_enabled: 'false' })
    expect((await portalLogin()).status).toBe(404)
    expect((await publicSettings()).portalEnabled).toBe(false)
    expect((await api(admin, 'GET', '/api/clients?pageSize=1')).status).toBe(200)
  })

  it('管理员开启后门户接口可用；只接受 true / false', async () => {
    expect((await api(admin, 'PUT', '/api/admin/settings', { portal_enabled: 'yes' })).status).toBe(400)
    expect((await api(admin, 'PUT', '/api/admin/settings', { portal_enabled: 'true' })).status).toBe(200)
    expect((await publicSettings()).portalEnabled).toBe(true)
    expect((await portalLogin()).status).not.toBe(404)
    await api(admin, 'PUT', '/api/admin/settings', { portal_enabled: 'false' })
  })
})
