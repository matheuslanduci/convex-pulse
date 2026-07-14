import path from 'node:path'

import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      'convex-pulse/angular': path.resolve(
        import.meta.dirname,
        '../../../angular/index.ts'
      )
    }
  },
  root: path.resolve(import.meta.dirname, 'app'),
  server: {
    host: '127.0.0.1',
    port: 4322,
    strictPort: true
  }
})
