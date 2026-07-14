import path from 'node:path'

import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      'convex-pulse/devtools': path.resolve(
        import.meta.dirname,
        '../../../devtools/index.ts'
      ),
      'convex-pulse/react': path.resolve(
        import.meta.dirname,
        '../../../react/index.ts'
      )
    }
  },
  root: path.resolve(import.meta.dirname, 'app'),
  server: {
    host: '127.0.0.1',
    port: 4317,
    strictPort: true
  }
})
