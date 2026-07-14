import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: {
            'convex-pulse/angular': `${import.meta.dirname}/angular/index.ts`
          }
        },
        test: {
          include: ['tests/angular/**/*.test.ts'],
          name: 'angular'
        }
      },
      {
        resolve: {
          alias: {
            'convex-pulse/devtools': `${import.meta.dirname}/devtools/index.ts`
          }
        },
        test: {
          environment: 'jsdom',
          include: ['tests/devtools/**/*.test.ts'],
          name: 'devtools'
        }
      },
      {
        resolve: {
          alias: {
            'convex-pulse/http': `${import.meta.dirname}/http/index.ts`,
            'convex-pulse/nextjs': `${import.meta.dirname}/nextjs/index.ts`
          }
        },
        test: {
          include: ['tests/http/**/*.test.ts'],
          name: 'http'
        }
      },
      {
        test: {
          include: ['tests/docs/**/*.test.ts'],
          name: 'docs'
        }
      },
      {
        test: {
          include: ['tests/package/**/*.test.ts'],
          name: 'package'
        }
      },
      {
        resolve: {
          alias: [
            {
              find: 'convex-pulse/http',
              replacement: `${import.meta.dirname}/http/index.ts`
            },
            {
              find: /^convex-pulse$/u,
              replacement: `${import.meta.dirname}/index.ts`
            }
          ]
        },
        test: {
          include: ['tests/node/**/*.test.ts'],
          name: 'node'
        }
      },
      {
        resolve: {
          alias: {
            'convex-pulse': `${import.meta.dirname}/index.ts`
          }
        },
        test: {
          include: ['tests/sync/**/*.test.ts'],
          name: 'sync'
        }
      },
      {
        resolve: {
          alias: {
            'convex-pulse/http': `${import.meta.dirname}/http/index.ts`,
            'convex-pulse/react': `${import.meta.dirname}/react/index.ts`
          }
        },
        test: {
          environment: 'jsdom',
          include: ['tests/react/**/*.test.tsx'],
          name: 'react'
        }
      },
      {
        resolve: {
          alias: {
            'convex-pulse/solid': `${import.meta.dirname}/solid/index.ts`
          }
        },
        test: {
          include: ['tests/solid/**/*.test.ts'],
          name: 'solid'
        }
      },
      {
        resolve: {
          alias: {
            'convex-pulse/vue': `${import.meta.dirname}/vue/index.ts`
          }
        },
        test: {
          environment: 'jsdom',
          include: ['tests/vue/**/*.test.ts'],
          name: 'vue'
        }
      },
      {
        resolve: {
          alias: [
            {
              find: 'convex-pulse/sveltekit/server',
              replacement: `${import.meta.dirname}/sveltekit/server.ts`
            },
            {
              find: 'convex-pulse/sveltekit',
              replacement: `${import.meta.dirname}/sveltekit/index.ts`
            },
            {
              find: 'convex-pulse/svelte',
              replacement: `${import.meta.dirname}/svelte/index.ts`
            },
            {
              find: 'convex-pulse/http',
              replacement: `${import.meta.dirname}/http/index.ts`
            }
          ]
        },
        test: {
          include: ['tests/svelte/**/*.test.ts'],
          name: 'svelte'
        }
      },
      {
        resolve: {
          alias: [
            {
              find: 'convex-pulse/http',
              replacement: `${import.meta.dirname}/http/index.ts`
            },
            {
              find: /^convex-pulse$/u,
              replacement: `${import.meta.dirname}/index.ts`
            }
          ]
        },
        test: {
          include: ['tests/e2e/**/*.test.ts'],
          name: 'e2e'
        }
      }
    ]
  }
})
