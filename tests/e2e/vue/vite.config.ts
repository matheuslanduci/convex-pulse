import path from 'node:path'

import { defineConfig } from 'vite'

export default defineConfig({
  define: {
    __VUE_OPTIONS_API__: false,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false
  },
  resolve: {
    alias: {
      'convex-pulse/vue': path.resolve(
        import.meta.dirname,
        '../../../vue/index.ts'
      )
    }
  },
  root: path.resolve(import.meta.dirname, 'app'),
  server: {
    host: '127.0.0.1',
    port: 4320,
    strictPort: true
  }
})
