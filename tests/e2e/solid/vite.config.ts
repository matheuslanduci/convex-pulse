import path from 'node:path'

import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      'convex-pulse/solid': path.resolve(
        import.meta.dirname,
        '../../../solid/index.ts'
      )
    },
    conditions: ['browser']
  },
  root: path.resolve(import.meta.dirname, 'app'),
  server: {
    host: '127.0.0.1',
    port: 4319,
    strictPort: true
  }
})
