import path from 'node:path'

import { defineConfig } from '@playwright/test'

export default defineConfig({
  expect: { timeout: 5000 },
  testDir: import.meta.dirname,
  use: { baseURL: 'http://127.0.0.1:4323' },
  webServer: {
    command: 'pnpm dev:app --host 127.0.0.1 --port 4323 --strictPort',
    cwd: path.resolve(import.meta.dirname, '../../../examples/tanstack-start'),
    reuseExistingServer: false,
    url: 'http://127.0.0.1:4323'
  }
})
