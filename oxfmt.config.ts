import { defineConfig } from 'oxfmt'
import ultracite from 'ultracite/oxfmt'

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    ...(ultracite.ignorePatterns ?? []),
    'svelte/*.svelte.js',
    'sveltekit/*.svelte.js'
  ],
  semi: false,
  singleQuote: true,
  trailingComma: 'none'
})
