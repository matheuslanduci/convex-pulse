# Convex Pulse

Typed, reactive Convex clients for JavaScript, Node.js, React, Angular, Solid, Svelte, SvelteKit, Vue, and Next.js.

Convex Pulse adds explicit query state, retries, prefetching, mutation lifecycle state, deduplication, optimistic collection operations, server-rendering helpers, and client devtools while preserving the generated Convex API types.

## Install

Install Convex Pulse together with its required Convex peer dependency:

```sh
pnpm add convex-pulse convex
```

Install the peer dependency for your UI framework as well. For example:

```sh
pnpm add convex-pulse convex react
```

## React example

```tsx
import {
  ConvexPulseReactClient,
  ConvexPulseReactProvider
} from 'convex-pulse/react'

const client = new ConvexPulseReactClient(import.meta.env.VITE_CONVEX_URL)

function Root() {
  return (
    <ConvexPulseReactProvider client={client}>
      <App />
    </ConvexPulseReactProvider>
  )
}
```

Inside a component, use the generated Convex API reference:

```tsx
import { useQuery } from 'convex-pulse/react'

import { api } from './convex/_generated/api'

function TaskList() {
  const tasks = useQuery(api.tasks.list)

  if (tasks.isPending) return <p>Loading…</p>
  if (tasks.isError) return <p>{tasks.error.message}</p>
  return tasks.data.map((task) => <p key={task._id}>{task.title}</p>)
}
```

## Entry points

| Application               | Import                          |
| ------------------------- | ------------------------------- |
| JavaScript or Node.js     | `convex-pulse`                  |
| Server or serverless HTTP | `convex-pulse/http`             |
| Next.js App Router        | `convex-pulse/nextjs`           |
| React                     | `convex-pulse/react`            |
| Angular                   | `convex-pulse/angular`          |
| Solid                     | `convex-pulse/solid`            |
| Svelte                    | `convex-pulse/svelte`           |
| SvelteKit                 | `convex-pulse/sveltekit`        |
| SvelteKit server helpers  | `convex-pulse/sveltekit/server` |
| Vue                       | `convex-pulse/vue`              |
| Client inspector          | `convex-pulse/devtools`         |

Read the documentation included with the project for complete setup, migration, authentication, server-rendering, optimistic update, and lifecycle guidance. Convex backend setup is covered by the [official Convex documentation](https://docs.convex.dev).

## Compatibility

Convex Pulse is ESM-only and requires Convex 1.42.1 or newer within the Convex 1.x line. Framework peer dependencies are optional; install only the bindings your application imports.

## License

MIT
