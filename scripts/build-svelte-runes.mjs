import { readFile, writeFile } from 'node:fs/promises'

import { transform } from 'esbuild'

const modules = [
  '../svelte/reactive.svelte.ts',
  '../sveltekit/transport.svelte.ts'
]

await Promise.all(modules.map(buildRuneModule))

async function buildRuneModule(modulePath) {
  const sourceUrl = new URL(modulePath, import.meta.url)
  const outputUrl = new URL(
    modulePath.replace(/\.ts$/u, '.js'),
    import.meta.url
  )
  const source = await readFile(sourceUrl, 'utf-8')
  const result = await transform(source, {
    format: 'esm',
    loader: 'ts',
    target: 'esnext'
  })
  await writeFile(
    outputUrl,
    `// Generated from ${modulePath.split('/').at(-1)}. Run pnpm build:svelte-runes.\n${result.code}`
  )
}
