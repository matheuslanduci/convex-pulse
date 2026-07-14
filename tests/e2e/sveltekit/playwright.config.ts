import path from 'node:path'

import { defineConfig } from '@playwright/test'

export default defineConfig({
  expect: { timeout: 5000 },
  testDir: import.meta.dirname,
  use: { baseURL: 'http://127.0.0.1:4322' },
  webServer: {
    command: 'pnpm dev:app --host 127.0.0.1 --port 4322 --strictPort',
    cwd: path.resolve(import.meta.dirname, '../../../examples/sveltekit'),
    reuseExistingServer: false,
    url: 'http://127.0.0.1:4322'
  }
})
