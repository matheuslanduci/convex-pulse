import type { FunctionReference, FunctionReturnType } from 'convex/server'
import { makeFunctionReference } from 'convex/server'
import { useMemo } from 'react'

import { preloadedQueryArgs, preloadedQueryResult } from '#http/index.js'
import type { PreloadedQuery } from '#http/index.js'
import { useQuery } from '#react/useQuery.js'

/** Hydrates a server-fetched query and keeps it live after the client connects. */
export function usePreloadedQuery<Query extends FunctionReference<'query'>>(
  preloaded: PreloadedQuery<Query>
): FunctionReturnType<Query> {
  const query = useMemo(
    () => makeFunctionReference(preloaded._name) as Query,
    [preloaded._name]
  )
  const args = useMemo(
    () => preloadedQueryArgs(preloaded),
    [preloaded._argsJSON]
  )
  const initialValue = useMemo(
    () => preloadedQueryResult(preloaded),
    [preloaded._valueJSON]
  )
  const result = useQuery(query, { args })

  if (result.status === 'error') {
    throw result.error
  }
  if (result.status === 'success') {
    return result.data
  }
  return initialValue
}
