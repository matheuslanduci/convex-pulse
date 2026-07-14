import { readFile } from 'node:fs/promises'

import { expect, it } from 'vitest'

const config = await readFile(
  new URL('../../blume.config.ts', import.meta.url),
  'utf-8'
)
const docs = await readFile(
  new URL('../../docs/index.mdx', import.meta.url),
  'utf-8'
)
const changelog = await readFile(
  new URL('../../changelog/site-launch.mdx', import.meta.url),
  'utf-8'
)
const home = await readFile(
  new URL('../../pages/index.astro', import.meta.url),
  'utf-8'
)
const favicon = await readFile(
  new URL('../../public/favicon.svg', import.meta.url),
  'utf-8'
)
const usage = await readFile(
  new URL('../../docs/usage.mdx', import.meta.url),
  'utf-8'
)
const migration = await readFile(
  new URL('../../docs/migration.mdx', import.meta.url),
  'utf-8'
)
const optimisticUpdates = await readFile(
  new URL('../../docs/guides/optimistic-updates.mdx', import.meta.url),
  'utf-8'
)
const serverRendering = await readFile(
  new URL('../../docs/guides/server-rendering.mdx', import.meta.url),
  'utf-8'
)
const librariesMeta = await readFile(
  new URL('../../docs/libraries/meta.ts', import.meta.url),
  'utf-8'
)
const packageJson = JSON.parse(
  await readFile(new URL('../../package.json', import.meta.url), 'utf-8')
) as PackageJson

it('mounts the documentation at /docs with top-level site navigation', () => {
  expect(config).toContain("'docs/**/*.{md,mdx}'")
  expect(config).toContain("'changelog/**/*.{md,mdx}'")
  expect(config).toContain("root: '.'")
  expect(config).toContain("logo: '/convex-pulse.svg'")
  expect(favicon).toContain('viewBox="180 140 175 225"')
  expect(favicon).toContain('stroke="currentColor"')
  expect(favicon).toContain('@media (prefers-color-scheme: dark)')
  expect(favicon).toContain(':root { color: #ffffff; }')
  expect(config).toContain("{ label: 'Docs', path: '/docs' }")
  expect(config).toContain("{ label: 'Changelog', path: '/changelog' }")
  expect(config).toContain("examples: 'docs/examples'")
  expect(packageJson.devDependencies.blume).toBeDefined()
  expect(packageJson.scripts['docs:dev']).toBe('blume dev')
  expect(packageJson.scripts['docs:build']).toBe('blume build --isolated')
})

it('provides a home page and an initial changelog entry', () => {
  expect(home).toContain('href="/docs"')
  expect(home).toContain('href="/changelog"')
  expect(home).toContain('Convex clients that keep your app in motion.')
  expect(home).not.toContain('See what’s new')
  expect(home).toContain('Copy to your agent')
  expect(home).toContain('navigator.clipboard.writeText(prompt)')
  expect(home).toContain(['$', '{window.location.origin}/docs'].join(''))
  expect(home).toContain(
    ['$', '{window.location.origin}/docs/migration'].join('')
  )
  expect(home).toContain('https://docs.convex.dev')
  expect(home).toContain('Convex Pulse only covers the client side')
  expect(changelog).toContain('type: changelog')
  expect(changelog).toContain('date: 2026-07-14')
})

it('provides an introduction, usage guide, and migration guide', () => {
  expect(docs).toContain('Choose a client')
  expect(docs).toContain('/docs/usage')
  expect(docs).toContain('/docs/migration')
  expect(usage).toContain('Read a live query')
  expect(usage).toContain('Update query data optimistically')
  expect(migration).toContain('JavaScript and Node.js')
  expect(migration).toContain('React queries')
})

it('provides a dedicated optimistic updates guide', () => {
  expect(optimisticUpdates).toContain('## Add an optimistic update')
  expect(optimisticUpdates).toContain('## Update arrays')
  expect(optimisticUpdates).toContain('## Update objects')
  expect(optimisticUpdates).toContain('## Update primitive values')
  expect(optimisticUpdates).toContain('## Understand reconciliation')
  expect(optimisticUpdates).toContain('optimisticId')
  expect(optimisticUpdates).toContain('keyBy')
  expect(optimisticUpdates).toContain('listId: data.listId')
  expect(optimisticUpdates).toContain(
    'capture it from the component instead of reading `data.listId`'
  )
  expect(optimisticUpdates).toContain('{ after: previousTaskId }')
  expect(optimisticUpdates).not.toContain('task.rank')
  expect(usage).toContain('/docs/guides/optimistic-updates')
})

it('provides reproducible framework-neutral Node setup and capability boundaries', async () => {
  const javascript = await readFile(
    new URL('../../docs/libraries/javascript.mdx', import.meta.url),
    'utf-8'
  )

  expect(javascript).toContain('mkdir my-app && cd my-app')
  expect(javascript).toContain('pnpm exec convex dev')
  expect(javascript).toContain('process.env.CONVEX_URL')
  expect(javascript).toContain('await client.close()')
  expect(javascript).toContain('omit that field from client `args`')
  expect(javascript).toContain(
    'each yielded value has the same successful shape'
  )
  expect(javascript).toContain('listId: data.listId')
  expect(javascript).toContain('## Lifecycle and prefetching')
  expect(docs).toContain('It does not expose framework lifecycle state')
})

it('documents stateless HTTP calls and server-rendered live queries', async () => {
  const http = await readFile(
    new URL('../../docs/libraries/http.mdx', import.meta.url),
    'utf-8'
  )
  const nextjs = await readFile(
    new URL('../../docs/libraries/nextjs.mdx', import.meta.url),
    'utf-8'
  )

  expect(http).toContain('ConvexPulseHttpClient')
  expect(http).toContain('preloadQuery')
  expect(http).toContain('the client object is stateful')
  expect(http).toContain('token === null || token === undefined ? {}')
  expect(http).toContain('There is no per-operation token option')
  expect(http).toContain('does not automatically retry HTTP operations')
  expect(http).toContain('JSON.stringify(payload)')
  expect(http).toContain('exposes no `close` or disposal method')
  expect(nextjs).toContain('usePreloadedQuery')
  expect(nextjs).toContain("cache: 'no-store'")
  expect(nextjs).toContain('Server-side authentication')
  expect(nextjs).toContain('pnpm create next-app@latest')
  expect(nextjs).toContain('app/convex-client-provider.tsx')
  expect(nextjs).toContain("import { api } from '@/convex/_generated/api'")
  expect(nextjs).toContain("'use server'")
  expect(nextjs).toContain("import { auth } from '@clerk/nextjs/server'")
  expect(nextjs).toContain('does not authenticate the live browser connection')
  expect(nextjs).toContain("dynamic = 'force-dynamic'")
  expect(nextjs).toContain('performs no explicit browser-client cleanup')
  expect(serverRendering).toContain('## Next.js App Router')
  expect(serverRendering).toContain('## TanStack Start')
  expect(serverRendering).toContain('pnpm dlx @tanstack/cli create my-app -y')
  expect(serverRendering).toContain('src/routes/__root.tsx')
  expect(serverRendering).toContain('.validator(validateLoadTasksInput)')
  expect(serverRendering).toContain(
    "loadTasks({ data: { listId: 'default' } })"
  )
  expect(serverRendering).toContain('process.env` inside the handler')
  expect(serverRendering).toContain('getRequest()')
  expect(serverRendering).toContain('performs no explicit cleanup')
  expect(serverRendering).toContain('## SvelteKit')
  expect(serverRendering).toContain('convexLoadPaginated')
  expect(serverRendering).toContain('decodeConvexLoad')
  expect(serverRendering).toContain('pnpm dlx sv create my-app')
  expect(serverRendering).toContain('"functions": "src/convex/"')
  expect(serverRendering).toContain('PUBLIC_CONVEX_URL=')
  expect(serverRendering).toContain('src/hooks.ts')
  expect(serverRendering).toContain('SvelteKit authentication')
  expect(serverRendering).toContain('withServerConvexToken')
  expect(serverRendering).toContain('AsyncLocalStorage')
})

it('documents constructor and React provider token fetchers', () => {
  expect(usage).toContain('fetchToken: ({ forceRefreshToken })')
  expect(usage).toContain('getToken({ skipCache: forceRefreshToken })')
  expect(usage).toContain('ConvexPulseReactProvider')
  expect(migration).toContain('fetchToken={fetchToken}')
})

it('provides an authentication guide for every framework', async () => {
  const frameworkNames = [
    'angular',
    'nextjs',
    'react',
    'solid',
    'svelte',
    'vue'
  ]

  const frameworks = await Promise.all(
    frameworkNames.map((frameworkName) =>
      readFile(
        new URL(`../../docs/libraries/${frameworkName}.mdx`, import.meta.url),
        'utf-8'
      )
    )
  )

  for (const framework of frameworks) {
    expect(framework).toContain('## Authentication')
    expect(framework).toContain('convex/auth.config.ts')
    expect(framework).toContain('forceRefreshToken')
  }

  const react = await readFile(
    new URL('../../docs/libraries/react.mdx', import.meta.url),
    'utf-8'
  )
  const nextjs = await readFile(
    new URL('../../docs/libraries/nextjs.mdx', import.meta.url),
    'utf-8'
  )

  expect(react).toContain('convex.clearAuth()')
  expect(nextjs).toContain('### Server-side authentication')
  expect(nextjs).toContain('### Browser authentication')
  expect(nextjs).toContain('isLoaded && isSignedIn ? fetchToken : undefined')
  expect(nextjs).toContain('isAuthLoading={!isLoaded}')
})

it('documents the Convex backend prerequisite used by client examples', () => {
  expect(usage).toContain('pnpm exec convex dev')
  expect(usage).toContain('task: defineTable({')
  expect(usage).toContain(".index('by_list', ['listId'])")
  expect(usage).toContain('export const list = query({')
  expect(usage).toContain('export const listPaginated = query({')
  expect(usage).toContain('export const create = mutation({')
  expect(usage).toContain('export const format = action({')
  expect(usage).toContain("import { api } from '../convex/_generated/api'")
})

it('provides a complete React bootstrap and cleanup guidance', async () => {
  const react = await readFile(
    new URL('../../docs/libraries/react.mdx', import.meta.url),
    'utf-8'
  )

  expect(react).toContain('pnpm create vite my-app --template react-ts')
  expect(react).toContain("import { createRoot } from 'react-dom/client'")
  expect(react).toContain("import { App } from './App'")
  expect(react).toContain('createRoot(rootElement).render(')
  expect(react).toContain('### Complete client component')
  expect(react).toContain("const listId = 'default'")
  expect(react).toContain('void createTask({ listId, title })')
  expect(react).toContain(
    "import type { PreloadedQuery } from 'convex-pulse/react'"
  )
  expect(react).toContain(
    "import type { Id } from '../convex/_generated/dataModel'"
  )
  expect(react).toContain('Do not close the shared browser client')
})

it('provides reproducible Angular setup and correct signal semantics', async () => {
  const angular = await readFile(
    new URL('../../docs/libraries/angular.mdx', import.meta.url),
    'utf-8'
  )

  expect(angular).toContain('@angular/cli@20 new my-app')
  expect(angular).toContain('declare const CONVEX_URL: string')
  expect(angular).toContain('Complete standalone component')
  expect(angular).toContain("from '../../convex/_generated/api'")
  expect(angular).toContain('args: { listId: this.listId() }')
  expect(angular).toContain(
    'Arguments go under `args` as a value, signal, or getter'
  )
  expect(angular).toContain(
    "import { injectQuery, skipToken } from 'convex-pulse/angular'"
  )
  expect(angular).toContain('Set `throwOnError: true`')
  expect(angular).toContain(
    'read `createTask.status`, not `createTask.status()`'
  )
  expect(angular).toContain('this.#destroyRef.onDestroy')
})

it('provides a complete Solid setup and accessor semantics', async () => {
  const solid = await readFile(
    new URL('../../docs/libraries/solid.mdx', import.meta.url),
    'utf-8'
  )

  expect(solid).toContain('pnpm create vite my-app --template solid-ts')
  expect(solid).toContain('### Complete client component')
  expect(solid).toContain("import { render } from 'solid-js/web'")
  expect(solid).toContain(
    'Arguments go under `args` as either a value or an accessor'
  )
  expect(solid).toContain("import { skipToken } from 'convex-pulse/solid'")
  expect(solid).toContain('Set `throwOnError: true`')
  expect(solid).toContain('Read `createTask.status`, not `createTask.status()`')
  expect(solid).toContain('listId: data.listId')
  expect(solid).toContain('onCleanup(() => cancelPrefetch?.())')
})

it('provides complete Svelte setup and readable-store semantics', async () => {
  const svelte = await readFile(
    new URL('../../docs/libraries/svelte.mdx', import.meta.url),
    'utf-8'
  )

  expect(svelte).toContain('pnpm create vite my-app --template svelte-ts')
  expect(svelte).toContain('### Complete client component')
  expect(svelte).toContain("import { api } from '../convex/_generated/api'")
  expect(svelte).toContain('Pass current Convex values, not stores')
  expect(svelte).toContain(
    'TypeScript correctly excludes the unreachable `disabled`'
  )
  expect(svelte).toContain('use `$createTask.status`')
  expect(svelte).toContain('listId: data.listId')
  expect(svelte).toContain('onDestroy(() => cancelPrefetch?.())')
  expect(svelte).toContain(
    'A plain Vite Svelte application has no server load phase'
  )
  expect(svelte).toContain('let { data }: PageProps = $props()')
  expect(svelte).toContain('createPreloadedQuery(client, data.preloadedTasks)')
  expect(svelte).toContain('A client may be page-scoped or app-scoped')
})

it('provides complete Vue setup and effect-scope semantics', async () => {
  const vue = await readFile(
    new URL('../../docs/libraries/vue.mdx', import.meta.url),
    'utf-8'
  )

  expect(vue).toContain('pnpm create vite my-app --template vue-ts')
  expect(vue).toContain('### Complete client component')
  expect(vue).toContain("import { createApp } from 'vue'")
  expect(vue).toContain("import App from './App.vue'")
  expect(vue).toContain(
    'Arguments go under `args` as a value, ref, computed ref, or getter'
  )
  expect(vue).toContain(
    "import { skipToken, useQuery } from 'convex-pulse/vue'"
  )
  expect(vue).toContain('Set `throwOnError: true`')
  expect(vue).toContain('listId: data.listId')
  expect(vue).toContain('onScopeDispose(() => cancelPrefetch?.())')
  expect(vue).toContain('does not currently expose a Vue equivalent')
  expect(vue).toContain('after `app.unmount()`')
})

it('groups individual references under Libraries without an intro page', () => {
  expect(librariesMeta).toContain("title: 'Libraries'")
  expect(librariesMeta).not.toContain("'index'")
  expect(docs).toContain('/docs/libraries/react')
})

it.each([
  ['javascript', 'ConvexPulseClient'],
  ['http', 'ConvexPulseHttpClient'],
  ['nextjs', 'preloadQuery'],
  ['react', 'ConvexPulseReactClient'],
  ['angular', 'ConvexPulseAngularClient'],
  ['solid', 'ConvexPulseSolidClient'],
  ['svelte', 'ConvexPulseSvelteClient'],
  ['vue', 'ConvexPulseVueClient'],
  ['devtools', 'mountConvexPulseDevtools']
] as const)('documents the %s client API', async (route, publicApi) => {
  const page = await readFile(
    new URL(`../../docs/libraries/${route}.mdx`, import.meta.url),
    'utf-8'
  )

  expect(page).toContain(publicApi)
})

it.each([
  ['angular', 'ConvexPulseAngularClient'],
  ['solid', 'ConvexPulseSolidClient'],
  ['vue', 'ConvexPulseVueClient']
] as const)('documents fetchToken for the %s client', async (route, client) => {
  const page = await readFile(
    new URL(`../../docs/libraries/${route}.mdx`, import.meta.url),
    'utf-8'
  )

  expect(page).toContain(`new ${client}`)
  expect(page).toContain('fetchToken: ({ forceRefreshToken })')
  expect(page).toContain('getToken({ skipCache: forceRefreshToken })')
})

it('documents reactive authentication for the svelte client', async () => {
  const page = await readFile(
    new URL('../../docs/libraries/svelte.mdx', import.meta.url),
    'utf-8'
  )

  expect(page).toContain('setupAuth')
  expect(page).toContain('useAuth()')
  expect(page).toContain('fetchAccessToken: ({ forceRefreshToken })')
  expect(page).toContain('getToken({ skipCache: forceRefreshToken })')
})

it.each([
  ['react', 'useQuery', 'Selecting data'],
  ['angular', 'injectQuery', 'Fetching and selecting data'],
  ['solid', 'createQuery', 'Fetching and selecting data'],
  ['svelte', 'createQuery', 'Fetching and selecting data'],
  ['vue', 'useQuery', 'Fetching and selecting data']
] as const)(
  'structures the %s reference by API and common query tasks',
  async (route, queryApi, selectingSection) => {
    const page = await readFile(
      new URL(`../../docs/libraries/${route}.mdx`, import.meta.url),
      'utf-8'
    )

    expect(page).toContain(`## \`${queryApi}\``)
    expect(page).toContain(`### ${selectingSection}`)
    expect(page).toContain('### Handling query state')
    expect(page).toContain('### Loading paginated data')
  }
)

it.each([
  ['javascript', 'action', 'client.action(api.tasks.format'],
  ['react', 'useAction', 'formatTask.isPending'],
  ['angular', 'injectAction', 'formatTask.isPending'],
  ['solid', 'createAction', 'formatTask.isPending'],
  ['svelte', 'createAction', 'formatTask.isPending'],
  ['vue', 'useAction', 'formatTask.isPending']
] as const)(
  'documents lifecycle-aware actions for the %s client',
  async (route, actionApi, lifecycleDocumentation) => {
    const page = await readFile(
      new URL(`../../docs/libraries/${route}.mdx`, import.meta.url),
      'utf-8'
    )

    expect(page).toContain(`## \`${actionApi}\``)
    expect(page).toContain(lifecycleDocumentation)
    expect(page).toContain('dedupe')
    expect(page).toContain('retries: 2')
  }
)

it('maps each framework page to its action primitive', async () => {
  const react = await readFile(
    new URL('../../docs/libraries/react.mdx', import.meta.url),
    'utf-8'
  )
  const angular = await readFile(
    new URL('../../docs/libraries/angular.mdx', import.meta.url),
    'utf-8'
  )
  const solid = await readFile(
    new URL('../../docs/libraries/solid.mdx', import.meta.url),
    'utf-8'
  )

  expect(react).toContain('## `useAction`')
  expect(angular).toContain('## `injectAction`')
  expect(solid).toContain('## `createAction`')
  expect(usage).toContain('## 4. Run an action')
  expect(usage).toContain('`status`, `data`, `error`, `isPending`')
})

type PackageJson = {
  devDependencies: Record<string, string>
  scripts: Record<string, string>
}
