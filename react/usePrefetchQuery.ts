import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs
} from 'convex/server'
import { useCallback } from 'react'

import { useConvexPulseReactClient } from '#react/ConvexPulseReactContext.js'

/** Creates a typed function that starts prefetching a Convex query. */
export function usePrefetchQuery<Query extends FunctionReference<'query'>>(
  query: Query
): PrefetchQuery<Query> {
  const client = useConvexPulseReactClient()
  return useCallback(
    (...args: OptionalRestArgs<Query>) =>
      client.prefetch(query, (args[0] ?? {}) as FunctionArgs<Query>),
    [client, query]
  )
}

/** @public */
export type PrefetchQuery<Query extends FunctionReference<'query'>> = (
  ...args: OptionalRestArgs<Query>
) => PrefetchHandle<FunctionReturnType<Query>>

/** @public */
export type PrefetchHandle<Data> = Readonly<{
  cancel: () => void
  ready: Promise<Data>
}>
