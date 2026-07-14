import { randomUUID } from 'node:crypto'

import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ConvexPulseHttpClient } from 'convex-pulse/http'
import {
  ConvexPulseReactClient,
  ConvexPulseReactProvider,
  useMutation,
  usePreloadedQuery
} from 'convex-pulse/react'
import { useEffect, useState } from 'react'

import { api } from '#convex/api'

const loadValue = createServerFn({ method: 'GET' }).handler(async () => {
  const runId = randomUUID()
  const client = new ConvexPulseHttpClient(
    requiredEnvironmentVariable(process.env.VITE_CONVEX_URL)
  )
  return {
    preloadedValue: await client.preloadQuery(api.fixture.getValue, {
      args: { key: 'preloaded', runId }
    }),
    runId
  }
})
const client = new ConvexPulseReactClient(
  requiredEnvironmentVariable(import.meta.env.VITE_CONVEX_URL)
)

export const Route = createFileRoute('/')({
  component: Home,
  loader: () => loadValue()
})

function Home() {
  const { preloadedValue, runId } = Route.useLoaderData()

  return (
    <ConvexPulseReactProvider convex={client}>
      <LiveValue preloadedValue={preloadedValue} runId={runId} />
    </ConvexPulseReactProvider>
  )
}

function LiveValue({ preloadedValue, runId }: LiveValueProps) {
  const [hydrated, setHydrated] = useState(false)
  const value = usePreloadedQuery(preloadedValue)
  const setValue = useMutation(api.fixture.setValue)

  useEffect(() => setHydrated(true), [])

  return (
    <main>
      <p>Value: {String(value)}</p>
      <button
        type="button"
        onClick={() =>
          void setValue({
            key: 'preloaded',
            runId,
            value: 'changed in TanStack Start'
          })
        }
      >
        Update value
      </button>
      <p>
        Mutation: {setValue.status}
        {setValue.error === null ? '' : `: ${setValue.error.message}`}
      </p>
      <p>Hydrated: {hydrated ? 'yes' : 'no'}</p>
    </main>
  )
}

function requiredEnvironmentVariable(value: string | undefined) {
  if (value === undefined) {
    throw new Error('VITE_CONVEX_URL is not set')
  }
  return value
}

type LiveValueProps = Awaited<ReturnType<typeof loadValue>>
