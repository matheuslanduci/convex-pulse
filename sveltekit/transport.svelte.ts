import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  PaginationResult
} from 'convex/server'
import { makeFunctionReference } from 'convex/server'

import type {
  PaginatedQueryArgs,
  PaginatedQueryItem,
  PaginatedQueryReference,
  UseQueryPaginationResult
} from '#client/Pagination.js'
import { getDisabledPaginationSnapshot } from '#client/Pagination.js'
import { skipToken } from '#client/QueryOptions.js'
import {
  createPreloadedQuery,
  preloadedQueryArgs,
  preloadedQueryResult
} from '#http/index.js'
import type { PreloadedQuery } from '#http/index.js'
import { createQuery } from '#svelte/index.js'
import type { SvelteQueryResult } from '#svelte/index.js'
import { getConvexClient } from '#svelte/lifecycle.js'
import { ConvexLoadPaginatedResult } from '#sveltekit/ConvexLoadPaginatedResult.js'
import { ConvexLoadResult } from '#sveltekit/ConvexLoadResult.js'
import { createConvexHttpClient } from '#sveltekit/http.js'
import type { CreateConvexHttpClientOptions } from '#sveltekit/http.js'

const isBrowser = globalThis.document !== undefined

export { ConvexLoadPaginatedResult } from '#sveltekit/ConvexLoadPaginatedResult.js'
export { ConvexLoadResult } from '#sveltekit/ConvexLoadResult.js'

export async function convexLoad<Query extends FunctionReference<'query'>>(
  query: Query,
  args: FunctionArgs<Query> | typeof skipToken,
  options: ConvexLoadOptions = {}
): Promise<ConvexLoadState<FunctionReturnType<Query>>> {
  if (args === skipToken) {
    return disabledQueryState
  }
  if (isBrowser) {
    const initialData = await getConvexClient().prefetch(query, args).ready
    return createDetachedQuery(query, args, initialData)
  }

  const data = await createConvexHttpClient(options).query(query, { args })
  return new ConvexLoadResult(createPreloadedQuery(query, args, data))
}

export async function convexLoadPaginated<
  Query extends PaginatedQueryReference
>(
  query: Query,
  args: PaginatedQueryArgs<Query> | typeof skipToken,
  options: ConvexLoadPaginatedOptions
): Promise<ConvexLoadPaginatedState<PaginatedQueryItem<Query>>> {
  if (args === skipToken) {
    return disabledPaginatedState() as ConvexLoadPaginatedState<
      PaginatedQueryItem<Query>
    >
  }
  const queryArgs = {
    ...args,
    paginationOpts: { cursor: null, numItems: options.initialNumItems }
  } as FunctionArgs<Query>
  if (isBrowser) {
    const initialData = await getConvexClient().prefetch(query, queryArgs).ready
    return createDetachedPaginatedQuery(
      query,
      args,
      options.initialNumItems,
      initialData
    )
  }

  const data = await createConvexHttpClient(options).query(query, {
    args: queryArgs
  })
  return new ConvexLoadPaginatedResult(
    createPreloadedQuery(query, queryArgs, data),
    options.initialNumItems
  )
}

export function encodeConvexLoad(value: unknown) {
  if (!(value instanceof ConvexLoadResult)) {
    return false
  }
  return value.preloaded
}

export function decodeConvexLoad(
  encoded: PreloadedQuery<FunctionReference<'query'>>
) {
  const query = makeFunctionReference<'query'>(encoded._name)
  return createDetachedQuery(
    query,
    preloadedQueryArgs(encoded),
    preloadedQueryResult(encoded)
  )
}

export function encodeConvexLoadPaginated(value: unknown) {
  if (!(value instanceof ConvexLoadPaginatedResult)) {
    return false
  }
  return {
    initialNumItems: value.initialNumItems,
    preloaded: value.preloaded
  }
}

export function decodeConvexLoadPaginated(encoded: EncodedPaginatedLoad) {
  const query = makeFunctionReference(
    encoded.preloaded._name
  ) as PaginatedQueryReference
  const queryArgs = preloadedQueryArgs(encoded.preloaded)
  const { paginationOpts: _, ...args } = queryArgs
  return createDetachedPaginatedQuery(
    query,
    args,
    encoded.initialNumItems,
    preloadedQueryResult(encoded.preloaded)
  )
}

function createDetachedQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  args: FunctionArgs<Query>,
  initialData: FunctionReturnType<Query>
): ConvexLoadState<FunctionReturnType<Query>> {
  let snapshot = $state<SvelteQueryResult<FunctionReturnType<Query>>>(
    successQuerySnapshot(initialData)
  )
  const store = createQuery(getConvexClient(), query, { args })
  store.subscribe((next) => {
    if (next.status !== 'pending') {
      snapshot = next
    }
  })
  return {
    get data() {
      return snapshot.data
    },
    get error() {
      return snapshot.error
    },
    get isLoading() {
      return snapshot.isLoading
    },
    get isStale() {
      return false
    },
    get status() {
      return snapshot.status
    }
  } as ConvexLoadState<FunctionReturnType<Query>>
}

function createDetachedPaginatedQuery<Query extends PaginatedQueryReference>(
  query: Query,
  args: PaginatedQueryArgs<Query>,
  initialNumItems: number,
  initialData: PaginationResult<PaginatedQueryItem<Query>>
): ConvexLoadPaginatedState<PaginatedQueryItem<Query>> {
  let snapshot = $state<UseQueryPaginationResult<PaginatedQueryItem<Query>>>(
    successPaginatedSnapshot(initialData)
  )
  const store = createQuery(getConvexClient(), query, {
    args,
    pagination: { initialNumItems }
  })
  store.subscribe((next) => {
    if (next.status !== 'pending') {
      snapshot = next
    }
  })
  return {
    get canLoadMore() {
      return snapshot.canLoadMore
    },
    get data() {
      return snapshot.data
    },
    get error() {
      return snapshot.error
    },
    get isLoading() {
      return snapshot.isLoading
    },
    get isLoadingMore() {
      return snapshot.isLoadingMore
    },
    get isStale() {
      return false
    },
    get loadMore() {
      return snapshot.loadMore
    },
    get status() {
      return snapshot.status
    }
  } as ConvexLoadPaginatedState<PaginatedQueryItem<Query>>
}

function successQuerySnapshot<Data>(data: Data) {
  return { data, error: null, isLoading: false, status: 'success' } as const
}

function successPaginatedSnapshot<Item>(
  result: PaginationResult<Item>
): UseQueryPaginationResult<Item> {
  return {
    canLoadMore: !result.isDone,
    data: result.page,
    error: null,
    isLoading: false,
    isLoadingMore: false,
    loadMore: noop,
    status: 'success'
  }
}

function disabledPaginatedState() {
  return { ...getDisabledPaginationSnapshot(), isStale: false }
}

function noop() {
  // Server-rendered pagination becomes active after transport decoding.
}

const disabledQueryState = {
  data: undefined,
  error: null,
  isLoading: false,
  isStale: false,
  status: 'disabled'
} as const

export type ConvexLoadOptions = CreateConvexHttpClientOptions

export type ConvexLoadPaginatedOptions = ConvexLoadOptions &
  Readonly<{ initialNumItems: number }>

export type ConvexLoadState<Data> =
  | (SvelteQueryResult<Data> & Readonly<{ isStale: boolean }>)
  | typeof disabledQueryState

export type ConvexLoadPaginatedState<Item> = UseQueryPaginationResult<Item> &
  Readonly<{ isStale: boolean }>

type EncodedPaginatedLoad = Readonly<{
  initialNumItems: number
  preloaded: PreloadedQuery<PaginatedQueryReference>
}>
