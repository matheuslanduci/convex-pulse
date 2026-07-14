import { defineConfig } from 'vite'

export default defineConfig({
  define: {
    __VUE_OPTIONS_API__: false,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false
  },
  resolve: {
    alias: {
      '#benchmark/api': `${import.meta.dirname}/../convex/_generated/api.js`
    }
  },
  root: `${import.meta.dirname}/app`,
  server: {
    host: '127.0.0.1',
    port: 4325,
    strictPort: true
  }
})
