import path from 'node:path'

import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      'convex-pulse/svelte': path.resolve(
        import.meta.dirname,
        '../../../svelte/index.ts'
      )
    }
  },
  root: path.resolve(import.meta.dirname, 'app'),
  server: {
    host: '127.0.0.1',
    port: 4321,
    strictPort: true
  }
})
