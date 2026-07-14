import path from 'node:path'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    tanstackStart({
      router: {
        routesDirectory: path.resolve(import.meta.dirname, 'app/src/routes')
      }
    }),
    viteReact()
  ],
  resolve: {
    alias: {
      '#convex/api': path.resolve(
        import.meta.dirname,
        '../convex/_generated/api.js'
      ),
      'convex-pulse/http': path.resolve(
        import.meta.dirname,
        '../../../http/index.ts'
      ),
      'convex-pulse/react': path.resolve(
        import.meta.dirname,
        '../../../react/index.ts'
      )
    }
  },
  root: path.resolve(import.meta.dirname, 'app'),
  server: { host: '127.0.0.1', port: 4323, strictPort: true }
})
