import path from 'node:path'

import { defineConfig } from '@playwright/test'

export default defineConfig({
  expect: { timeout: 5000 },
  testDir: import.meta.dirname,
  use: { baseURL: 'http://127.0.0.1:4321' },
  webServer: {
    command: 'pnpm dev:app --hostname 127.0.0.1 --port 4321',
    cwd: path.resolve(import.meta.dirname, '../../../examples/nextjs'),
    reuseExistingServer: false,
    url: 'http://127.0.0.1:4321'
  }
})
