import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType
} from 'convex/server'
import { getFunctionName } from 'convex/server'
import { useMemo, useRef, useSyncExternalStore } from 'react'

import { getDisabledQuerySnapshot } from '#client/FrameworkClient.js'
import type { FrameworkQueryDisabledResult } from '#client/FrameworkClient.js'
import {
  getDisabledPaginationSnapshot,
  preparePaginatedQuery
} from '#client/Pagination.js'
import type {
  PaginatedQueryArgs,
  PaginatedQueryItem,
  PaginatedQueryReference,
  UseQueryPaginationResult
} from '#client/Pagination.js'
import { skipToken } from '#client/QueryOptions.js'
import type { QueryArgs } from '#client/QueryOptions.js'
import { canonicalConvexValue } from '#client/valueCodec.js'
import { useConvexPulseReactClient } from '#react/ConvexPulseReactContext.js'
import { useOnDataChange } from '#react/useOnDataChange.js'
import type { DataChangeResult, OnDataChange } from '#react/useOnDataChange.js'

/** Subscribes a React component to a Convex query. */
export function useQuery<
  Query extends PaginatedQueryReference,
  ThrowOnError extends boolean = false
>(
  query: Query,
  options: UseQueryPaginationOptions<Query, ThrowOnError>
): UseQueryPaginationResult<PaginatedQueryItem<Query>, ThrowOnError>
export function useQuery<
  Query extends FunctionReference<'query'>,
  Selected = FunctionReturnType<Query>,
  ThrowOnError extends boolean = false
>(
  query: Query,
  options: UseQueryOptions<Query, Selected, ThrowOnError>
): UseQueryResult<Selected, ThrowOnError>
export function useQuery<
  Query extends FunctionReference<'query'>,
  Selected = FunctionReturnType<Query>
>(
  query: Query,
  options:
    | UseQueryOptions<Query, Selected, boolean>
    | UseQueryPaginationOptions<PaginatedQueryReference, boolean>
): UseQueryResult<Selected> | UseQueryPaginationResult<unknown> {
  const client = useConvexPulseReactClient()
  const paginated = 'pagination' in options
  const initialNumItems = paginated ? options.pagination.initialNumItems : null
  const select = 'select' in options ? options.select : undefined
  const selectRef = useRef(select)
  selectRef.current = select
  const hasSelect = select !== undefined
  const skipped = options.args === skipToken || options.enabled === false
  const args = options.args === skipToken ? {} : options.args
  const argsKey = skipped ? 'skip' : JSON.stringify(canonicalConvexValue(args))
  const queryName = getFunctionName(query)
  const handle = useMemo(() => {
    if (skipped) {
      return null
    }
    if (paginated) {
      return preparePaginatedQuery(
        (reference, pageArgs) =>
          client.prepareQuery(reference, pageArgs, undefined, options.retries),
        query as PaginatedQueryReference,
        args as PaginatedQueryArgs<PaginatedQueryReference>,
        initialNumItems as number
      )
    }
    return client.prepareQuery(
      query,
      args as FunctionArgs<Query>,
      hasSelect
        ? (data) => (selectRef.current as NonNullable<typeof select>)(data)
        : undefined,
      options.retries
    )
  }, [
    argsKey,
    client,
    hasSelect,
    initialNumItems,
    paginated,
    queryName,
    skipped,
    options.retries
  ])
  const enabled = !skipped
  const disabledSnapshot = paginated
    ? getDisabledPaginationSnapshot
    : getDisabledQuerySnapshot
  const getSnapshot = (handle?.getSnapshot ?? disabledSnapshot) as () =>
    | UseQueryResult<Selected>
    | UseQueryPaginationResult<unknown>
  const result = useSyncExternalStore(
    enabled
      ? (handle?.subscribe ?? subscribeDisabledQuery)
      : subscribeDisabledQuery,
    enabled ? getSnapshot : disabledSnapshot,
    enabled ? getSnapshot : disabledSnapshot
  )
  useOnDataChange(
    result as DataChangeResult<unknown>,
    (options.onDataChange ?? noop) as OnDataChange<unknown>
  )
  if (options.throwOnError === true && result.status === 'error') {
    throw result.error
  }
  return result
}

function subscribeDisabledQuery() {
  return noop
}

function noop() {
  // Disabled queries have no subscription to release.
}

/** @public */
export type UseQueryOptions<
  Query extends FunctionReference<'query'>,
  Selected = FunctionReturnType<Query>,
  ThrowOnError extends boolean = false
> = Readonly<{
  args: QueryArgs<FunctionArgs<Query>>
  enabled?: boolean
  onDataChange?: OnDataChange<Selected>
  retries?: number
  select?: (data: FunctionReturnType<Query>) => Selected
  throwOnError?: ThrowOnError
}>

/** Options for incrementally loading a paginated query through useQuery. */
export type UseQueryPaginationOptions<
  Query extends PaginatedQueryReference,
  ThrowOnError extends boolean = false
> = Readonly<{
  args: QueryArgs<PaginatedQueryArgs<Query>>
  enabled?: boolean
  onDataChange?: OnDataChange<PaginatedQueryItem<Query>[]>
  pagination: Readonly<{ initialNumItems: number }>
  retries?: number
  throwOnError?: ThrowOnError
}>

/** @public */
export type UseQueryResult<Data, ThrowOnError extends boolean = false> =
  | FrameworkQueryDisabledResult
  | UseQueryPendingResult
  | (ThrowOnError extends true ? never : UseQueryErrorResult)
  | UseQuerySuccessResult<Data>

/** @public */
export type UseQueryPendingResult = Readonly<{
  data: undefined
  error: null
  isLoading: true
  status: 'pending'
}>

/** @public */
export type UseQueryErrorResult = Readonly<{
  data: undefined
  error: Error
  isLoading: false
  status: 'error'
}>

/** @public */
export type UseQuerySuccessResult<Data> = Readonly<{
  data: Data
  error: null
  isLoading: false
  status: 'success'
}>
