import { readFile } from 'node:fs/promises'

import { expect, it } from 'vitest'

const rootIndex = await readFile(
  new URL('../../index.ts', import.meta.url),
  'utf-8'
)
const packageJson = JSON.parse(
  await readFile(new URL('../../package.json', import.meta.url), 'utf-8')
) as PackageJson

it('publishes compiled JavaScript and declaration entrypoints', () => {
  for (const target of Object.values(packageJson.exports)) {
    expect(target.import).toMatch(/^\.\/dist\/.*\.js$/u)
    expect(target.types).toMatch(/^\.\/dist\/.*\.d\.ts$/u)
  }
})

it('declares Convex as a required peer dependency', () => {
  expect(packageJson.peerDependencies.convex).toBe('>=1.42.1 <2')
  expect(packageJson.peerDependenciesMeta.convex).toBeUndefined()
})

it('publishes only compiled output and package metadata', () => {
  expect(packageJson.files).toEqual(['dist', 'LICENSE', 'README.md'])
})

it('exports pagination options from the root entrypoint', () => {
  expect(rootIndex).toContain('QueryPaginationOptions')
})

type PackageJson = {
  exports: Record<string, { import: string; types: string }>
  files: string[]
  peerDependencies: Record<string, string>
  peerDependenciesMeta: Record<string, { optional: boolean }>
}
