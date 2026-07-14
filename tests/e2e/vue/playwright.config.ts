import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: import.meta.dirname,
  timeout: 120_000,
  use: {
    baseURL: 'http://127.0.0.1:4320'
  },
  webServer: {
    command: '../node_modules/.bin/vite --config vite.config.ts',
    reuseExistingServer: false,
    url: 'http://127.0.0.1:4320'
  }
})
