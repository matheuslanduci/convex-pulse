import { defineConfig } from 'oxlint'
import core from 'ultracite/oxlint/core'

export default defineConfig({
  extends: [core],
  ignorePatterns: [
    ...(core.ignorePatterns as string[]),
    'examples/**',
    'svelte/*.svelte.js',
    'sveltekit/*.svelte.js'
  ],
  rules: {
    'func-style': ['error', 'declaration'],
    'no-use-before-define': 'off',
    'promise/avoid-new': 'off',
    'promise/prefer-await-to-callbacks': 'off',
    'typescript/consistent-type-definitions': ['error', 'type'],
    'unicorn/filename-case': 'off'
  }
})
