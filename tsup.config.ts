import { defineConfig } from 'tsup'

export default defineConfig([
  {
    clean: true,
    entry: {
      'angular/index': 'angular/index.ts',
      'devtools/index': 'devtools/index.ts',
      'http/index': 'http/index.ts',
      index: 'index.ts',
      'nextjs/index': 'nextjs/index.ts',
      'react/index': 'react/index.ts',
      'solid/index': 'solid/index.ts',
      'svelte/index': 'svelte/index.ts',
      'sveltekit/index': 'sveltekit/index.ts',
      'sveltekit/server': 'sveltekit/server.ts',
      'vue/index': 'vue/index.ts'
    },
    format: ['esm'],
    sourcemap: true,
    splitting: true,
    target: 'es2022',
    treeshake: true
  },
  {
    clean: false,
    entry: {
      'svelte/index.svelte': 'svelte/index.ts',
      'sveltekit/index.svelte': 'sveltekit/index.ts'
    },
    format: ['esm'],
    sourcemap: true,
    splitting: false,
    target: 'es2022',
    treeshake: true
  }
])
