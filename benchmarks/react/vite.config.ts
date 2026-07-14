import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '#benchmark/api': `${import.meta.dirname}/../convex/_generated/api.js`
    }
  },
  root: `${import.meta.dirname}/app`,
  server: {
    host: '127.0.0.1',
    port: 4318
  }
})
