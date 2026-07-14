import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const runtimeDirectory = path.join(root, '.blume-verify')

try {
  execFileSync('pnpm', ['docs:build'], {
    cwd: root,
    stdio: 'inherit'
  })

  assertRoute('', [
    '<title>Convex Pulse — Reactive Convex clients for every TypeScript app',
    'rel="icon"',
    'image/svg+xml',
    'Convex clients that keep your app in motion.',
    'href="/docs"',
    'href="/changelog"',
    'convex-pulse-title',
    'Copy to your agent',
    'already uses Convex',
    '/docs/migration',
    'https://docs.convex.dev',
    'Convex Pulse only covers the client side',
    'Agent prompt copied to your clipboard.'
  ])
  assertRouteExcludes('', ['See what’s new'])
  assertRoute('docs', [
    '<title>Introduction',
    'Choose a client',
    'convex-pulse-title',
    '>Docs</a>',
    '>Changelog</a>'
  ])
  assertRoute('changelog', [
    '<title>Convex Pulse Changelog',
    'A new home for Convex Pulse',
    'Website'
  ])
  assertRoute('docs/usage', [
    '<title>How to use Convex Pulse',
    'Before you start',
    'convex dev',
    'Read a live query',
    'Authenticate'
  ])
  assertRoute('docs/migration', [
    '<title>Migration guide',
    'JavaScript and Node.js',
    'React queries'
  ])
  assertRouteMissing('docs/clients')
  assertRouteMissing('docs/libraries')
  assertRoute('docs/guides/optimistic-updates', [
    '<title>Optimistic updates',
    'Update arrays',
    'Understand reconciliation'
  ])
  assertRoute('docs/guides/server-rendering', [
    '<title>Server rendering',
    'TanStack Start',
    'TanStack Start authentication and cleanup',
    'validateLoadTasksInput',
    'SvelteKit',
    'PUBLIC_CONVEX_URL',
    'SvelteKit authentication',
    'decodeConvexLoadPaginated'
  ])
  assertRoute('docs/libraries/javascript', [
    'ConvexPulseClient',
    'For a new Node.js TypeScript project',
    'watchQuery',
    'Lifecycle and prefetching',
    'Executing an action',
    'Selecting data'
  ])
  assertRoute('docs/libraries/http', [
    'ConvexPulseHttpClient',
    'Preload a live query',
    'Authenticate a request',
    'Errors and retries',
    'Cleanup'
  ])
  assertRoute('docs/libraries/nextjs', [
    'Provide the browser client',
    'Preload a reactive Client Component',
    'usePreloadedQuery',
    'Server-side authentication',
    'Rendering, errors, and cleanup'
  ])
  assertRoute('docs/libraries/react', [
    'ConvexPulseReactClient',
    'createRoot',
    'Complete client component',
    'Component cleanup',
    'useMutation',
    'Executing an action',
    'Selecting data'
  ])
  assertRoute('docs/libraries/angular', [
    'ConvexPulseAngularClient',
    'Complete standalone component',
    'CONVEX_URL',
    'injectQuery',
    'Executing and retrying an action'
  ])
  assertRoute('docs/libraries/solid', [
    'ConvexPulseSolidClient',
    'Complete client component',
    'onCleanup',
    'createQuery',
    'Executing and retrying an action'
  ])
  assertRoute('docs/libraries/svelte', [
    'ConvexPulseSvelteClient',
    'Complete client component',
    'plain Vite Svelte application',
    'createQuery',
    'Executing and retrying an action'
  ])
  assertRoute('docs/libraries/vue', [
    'ConvexPulseVueClient',
    'Complete client component',
    'onScopeDispose',
    'does not currently expose a Vue equivalent',
    'useQuery',
    'Executing and retrying an action'
  ])
  assertRoute('docs/libraries/devtools', [
    'mountConvexPulseDevtools',
    'initialIsOpen'
  ])
} finally {
  rmSync(runtimeDirectory, { force: true, recursive: true })
}

function assertRoute(route, expectedValues) {
  const html = readFileSync(
    path.join(runtimeDirectory, 'dist', route, 'index.html'),
    'utf-8'
  )

  for (const expected of expectedValues) {
    assertIncludes(html, expected)
  }
}

function assertRouteMissing(route) {
  const routePath = path.join(runtimeDirectory, 'dist', route, 'index.html')

  if (existsSync(routePath)) {
    throw new Error(`Built /${route} route should not exist`)
  }
}

function assertRouteExcludes(route, excludedValues) {
  const html = readFileSync(
    path.join(runtimeDirectory, 'dist', route, 'index.html'),
    'utf-8'
  )

  for (const excluded of excludedValues) {
    if (html.includes(excluded)) {
      throw new Error(`Built /${route} page unexpectedly includes ${excluded}`)
    }
  }
}

function assertIncludes(value, expected) {
  if (!value.includes(expected)) {
    throw new Error(`Built /docs page is missing ${expected}`)
  }
}
