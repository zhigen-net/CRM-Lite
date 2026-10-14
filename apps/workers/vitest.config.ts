import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'

// 测试在 Workers 运行时（Miniflare）中执行，使用本地 D1；不连接任何远程资源
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, 'migrations'))
  return {
    plugins: [
      cloudflareTest({
        main: './src/index.ts',
        remoteBindings: false,
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, JWT_SECRET: 'test-secret', PORTAL_JWT_SECRET: 'test-portal-secret' },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
    },
  }
})
