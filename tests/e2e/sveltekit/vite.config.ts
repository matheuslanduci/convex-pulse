import path from 'node:path'

import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [sveltekit()],
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
      'convex-pulse/svelte': path.resolve(
        import.meta.dirname,
        '../../../svelte/index.ts'
      )
    }
  },
  server: { host: '127.0.0.1', port: 4322, strictPort: true }
})
