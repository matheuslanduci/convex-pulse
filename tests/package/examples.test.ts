import { readFile } from 'node:fs/promises'

import { expect, it } from 'vitest'

const exampleNames = ['nextjs', 'tanstack-start', 'sveltekit'] as const

it.each(exampleNames)('%s ships a runnable Convex backend', async (name) => {
  const directory = new URL(`../../examples/${name}/`, import.meta.url)
  const packageJson = JSON.parse(
    await readFile(new URL('package.json', directory), 'utf-8')
  ) as PackageJson
  const convexJson = JSON.parse(
    await readFile(new URL('convex.json', directory), 'utf-8')
  ) as ConvexJson
  const functionsDirectory = new URL(convexJson.functions, directory)
  const schema = await readFile(
    new URL('schema.ts', functionsDirectory),
    'utf-8'
  )
  const tasks = await readFile(new URL('tasks.ts', functionsDirectory), 'utf-8')

  expect(packageJson.scripts.dev).toContain("convex dev --start 'pnpm dev:app'")
  expect(packageJson.scripts['dev:app']).toBeDefined()
  expect(schema).toContain('task: defineTable({ title: v.string() })')
  expect(tasks).toContain('export const list = query({')
  expect(tasks).toContain('export const create = mutation({')
  expect(tasks).toContain('export const remove = mutation({')
})

it('keeps the Next.js preload request-scoped during production builds', async () => {
  const page = await readFile(
    new URL('../../examples/nextjs/app/page.tsx', import.meta.url),
    'utf-8'
  )

  expect(page).toContain("export const dynamic = 'force-dynamic'")
})

type ConvexJson = { functions: string }

type PackageJson = { scripts: Record<string, string> }
