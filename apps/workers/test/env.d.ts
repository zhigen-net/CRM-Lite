/// <reference types="@cloudflare/vitest-plugin/types" />
import type { D1Migration } from '@cloudflare/vitest-plugin'

declare global {
  namespace Cloudflare {
    interface Env extends globalThis.Env {
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}
