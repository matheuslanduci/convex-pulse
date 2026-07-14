import { defineConfig } from '@playwright/test'

export default defineConfig({
  expect: {
    timeout: 5000
  },
  testDir: import.meta.dirname,
  use: {
    baseURL: 'http://127.0.0.1:4317'
  },
  webServer: {
    command: '../node_modules/.bin/vite --config vite.config.ts',
    reuseExistingServer: false,
    url: 'http://127.0.0.1:4317'
  }
})
