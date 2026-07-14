'use client'

import type { PreloadedQuery } from 'convex-pulse/react'
import {
  ConvexPulseReactClient,
  ConvexPulseReactProvider,
  useMutation,
  usePreloadedQuery
} from 'convex-pulse/react'

import { api } from '#convex/api'

const client = new ConvexPulseReactClient(
  requiredEnvironmentVariable(process.env.NEXT_PUBLIC_CONVEX_URL)
)

export function LiveValue(props: LiveValueProps) {
  return (
    <ConvexPulseReactProvider convex={client}>
      <Value {...props} />
    </ConvexPulseReactProvider>
  )
}

function Value({ preloadedValue, runId }: LiveValueProps) {
  const value = usePreloadedQuery(preloadedValue)
  const setValue = useMutation(api.fixture.setValue)

  return (
    <main>
      <p>Value: {String(value)}</p>
      <button
        type="button"
        onClick={() =>
          void setValue({
            key: 'preloaded',
            runId,
            value: 'changed in Next.js'
          })
        }
      >
        Update value
      </button>
    </main>
  )
}

function requiredEnvironmentVariable(value: string | undefined) {
  if (value === undefined) {
    throw new Error('NEXT_PUBLIC_CONVEX_URL is not set')
  }
  return value
}

type LiveValueProps = Readonly<{
  preloadedValue: PreloadedQuery<typeof api.fixture.getValue>
  runId: string
}>
