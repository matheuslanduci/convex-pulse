/* oxlint-disable import/no-cycle -- rune helpers use the public low-level Svelte API */
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType
} from 'convex/server'

import type { FrameworkQueryDisabledResult } from '#client/FrameworkClient.js'
import type {
  PaginatedQueryArgs,
  PaginatedQueryItem,
  PaginatedQueryReference,
  UseQueryPaginationResult
} from '#client/Pagination.js'
import { getDisabledPaginationSnapshot } from '#client/Pagination.js'
import { skipToken } from '#client/QueryOptions.js'
import type { QueryArgs as QueryArgsValue } from '#client/QueryOptions.js'
import { createQuery } from '#svelte/index.js'
import type {
  CreateQueryPaginationOptions,
  SvelteQueryErrorResult,
  SvelteQueryResult
} from '#svelte/index.js'
import {
  getAuthContext,
  setAuthContext,
  useConvexClient
} from '#svelte/lifecycle.js'

export function useQuery<
  Query extends FunctionReference<'query'>,
  Selected = FunctionReturnType<Query>,
  ThrowOnError extends boolean = false
>(
  query: Query,
  args: SvelteQueryArgs<Query>,
  options: SvelteUseQueryOptions<Query, Selected, ThrowOnError> = {}
): SvelteUseQueryResult<Selected, ThrowOnError> {
  const client = useConvexClient()
  const initialArgs = resolveArgs(args)
  const initialKey = argsKey(initialArgs)
  let initialDataActive = options.initialData !== undefined
  let isStale = $state(false)
  let snapshot = $state<SvelteQueryResult<Selected>>(
    initialQuerySnapshot(initialArgs, options.initialData)
  )

  $effect(() => {
    const currentArgs = resolveArgs(args)
    const currentKey = argsKey(currentArgs)
    if (currentArgs === skipToken) {
      initialDataActive = false
      isStale = false
      snapshot = disabledQuerySnapshot
      return
    }

    if (currentKey !== initialKey) {
      initialDataActive = false
    }
    const queryStore = createQuery(client, query, {
      args: $state.snapshot(currentArgs),
      ...(options.onDataChange === undefined
        ? {}
        : { onDataChange: options.onDataChange }),
      ...(options.retries === undefined ? {} : { retries: options.retries }),
      ...(options.select === undefined ? {} : { select: options.select })
    })
    return queryStore.subscribe((next) => {
      if (next.status === 'pending') {
        if (
          initialDataActive ||
          (options.keepPreviousData && snapshot.status === 'success')
        ) {
          isStale = !initialDataActive
          return
        }
      } else {
        initialDataActive = false
        isStale = false
      }
      snapshot = next
    })
  })

  function current() {
    if (options.throwOnError === true && snapshot.status === 'error') {
      throw snapshot.error
    }
    return snapshot
  }

  return {
    get data() {
      return current().data
    },
    get error() {
      return current().error
    },
    get isLoading() {
      return current().isLoading
    },
    get isStale() {
      current()
      return isStale
    },
    get status() {
      return current().status
    }
  } as SvelteUseQueryResult<Selected, ThrowOnError>
}

export function usePaginatedQuery<
  Query extends PaginatedQueryReference,
  ThrowOnError extends boolean = false
>(
  query: Query,
  args: SveltePaginatedQueryArgs<Query>,
  options: SvelteUsePaginatedQueryOptions<Query, ThrowOnError>
): SvelteUsePaginatedQueryResult<PaginatedQueryItem<Query>, ThrowOnError> {
  const client = useConvexClient()
  const initialArgs = resolvePaginatedArgs(args)
  const initialKey = argsKey(initialArgs)
  let initialDataActive = options.initialData !== undefined
  let isStale = $state(false)
  let snapshot = $state<UseQueryPaginationResult<PaginatedQueryItem<Query>>>(
    initialPaginationSnapshot(initialArgs, options.initialData)
  )

  $effect(() => {
    const currentArgs = resolvePaginatedArgs(args)
    const currentKey = argsKey(currentArgs)
    if (currentArgs === skipToken) {
      initialDataActive = false
      isStale = false
      snapshot = getDisabledPaginationSnapshot()
      return
    }
    if (currentKey !== initialKey) {
      initialDataActive = false
    }
    const queryOptions = {
      args: $state.snapshot(currentArgs) as PaginatedQueryArgs<Query>,
      ...(options.onDataChange === undefined
        ? {}
        : { onDataChange: options.onDataChange }),
      pagination: { initialNumItems: options.initialNumItems },
      ...(options.retries === undefined ? {} : { retries: options.retries })
    } satisfies CreateQueryPaginationOptions<Query>
    const queryStore = createQuery(client, query, queryOptions)
    return queryStore.subscribe((next) => {
      if (next.status === 'pending') {
        if (
          initialDataActive ||
          (options.keepPreviousData && snapshot.status === 'success')
        ) {
          isStale = !initialDataActive
          return
        }
      } else {
        initialDataActive = false
        isStale = false
      }
      snapshot = next
    })
  })

  function current() {
    if (options.throwOnError === true && snapshot.status === 'error') {
      throw snapshot.error
    }
    return snapshot
  }

  return {
    get canLoadMore() {
      return current().canLoadMore
    },
    get data() {
      return current().data
    },
    get error() {
      return current().error
    },
    get isLoading() {
      return current().isLoading
    },
    get isLoadingMore() {
      return current().isLoadingMore
    },
    get isStale() {
      current()
      return isStale
    },
    get loadMore() {
      return current().loadMore
    },
    get status() {
      return current().status
    }
  } as SvelteUsePaginatedQueryResult<PaginatedQueryItem<Query>, ThrowOnError>
}

export function setupAuth(
  provider: SvelteAuthProviderGetter,
  options: SvelteSetupAuthOptions = {}
) {
  const client = useConvexClient()
  const initialProvider = provider()
  const state = $state({
    isAuthenticated:
      options.initialState?.isAuthenticated ??
      (!initialProvider.isLoading && initialProvider.isAuthenticated),
    isLoading:
      options.initialState === undefined ? initialProvider.isLoading : false,
    isRefreshing: false
  })
  const context = {
    get isAuthenticated() {
      return state.isAuthenticated
    },
    get isLoading() {
      return state.isLoading
    },
    get isRefreshing() {
      return state.isRefreshing
    }
  }
  setAuthContext(context)

  $effect(() => {
    const current = provider()
    if (current.isLoading) {
      state.isLoading = true
      return
    }
    if (!current.isAuthenticated) {
      client.clearAuth()
      state.isAuthenticated = false
      state.isLoading = false
      state.isRefreshing = false
      return
    }

    let active = true
    state.isLoading = true
    client.setAuth(current.fetchAccessToken, {
      onChange: (isAuthenticated) => {
        if (active) {
          state.isAuthenticated = isAuthenticated
          state.isLoading = false
        }
      },
      onRefreshChange: (isRefreshing) => {
        if (active) {
          state.isRefreshing = isRefreshing
        }
      }
    })
    return () => {
      active = false
      client.clearAuth()
    }
  })

  return context
}

export function useAuth() {
  const context = getAuthContext()
  if (context === undefined) {
    throw new Error(
      'No Convex Pulse auth state was found in Svelte context. Call setupAuth() in a parent component.'
    )
  }
  return context
}

function resolveArgs<Query extends FunctionReference<'query'>>(
  args: SvelteQueryArgs<Query>
) {
  return typeof args === 'function'
    ? (args as () => QueryArgsValue<FunctionArgs<Query>>)()
    : args
}

function resolvePaginatedArgs<Query extends PaginatedQueryReference>(
  args: SveltePaginatedQueryArgs<Query>
) {
  return typeof args === 'function' ? args() : args
}

function argsKey(args: Readonly<Record<string, unknown>> | typeof skipToken) {
  return args === skipToken ? skipToken : JSON.stringify(args)
}

function initialQuerySnapshot<Data>(
  args: Readonly<Record<string, unknown>> | typeof skipToken,
  initialData: Data | undefined
): SvelteQueryResult<Data> {
  if (args === skipToken) {
    return disabledQuerySnapshot
  }
  if (initialData === undefined) {
    return pendingQuerySnapshot
  }
  return successQuerySnapshot(initialData)
}

function initialPaginationSnapshot<Item>(
  args: Readonly<Record<string, unknown>> | typeof skipToken,
  initialData: Item[] | undefined
): UseQueryPaginationResult<Item> {
  if (args === skipToken) {
    return getDisabledPaginationSnapshot() as UseQueryPaginationResult<Item>
  }
  if (initialData === undefined) {
    return pendingPaginationSnapshot()
  }
  return successPaginationSnapshot(initialData)
}

function successQuerySnapshot<Data>(data: Data) {
  return { data, error: null, isLoading: false, status: 'success' } as const
}

function pendingPaginationSnapshot(): UseQueryPaginationResult<never> {
  return {
    canLoadMore: false,
    data: undefined,
    error: null,
    isLoading: true,
    isLoadingMore: false,
    loadMore: noop,
    status: 'pending'
  }
}

function successPaginationSnapshot<Item>(
  data: Item[]
): UseQueryPaginationResult<Item> {
  return {
    canLoadMore: false,
    data,
    error: null,
    isLoading: false,
    isLoadingMore: false,
    loadMore: noop,
    status: 'success'
  }
}

function noop() {
  // Initial and disabled pagination cannot load another page.
}

const disabledQuerySnapshot: FrameworkQueryDisabledResult = {
  data: undefined,
  error: null,
  isLoading: false,
  status: 'disabled'
}

const pendingQuerySnapshot = {
  data: undefined,
  error: null,
  isLoading: true,
  status: 'pending'
} as const

export type SvelteQueryArgs<Query extends FunctionReference<'query'>> =
  | QueryArgsValue<FunctionArgs<Query>>
  | (() => QueryArgsValue<FunctionArgs<Query>>)

export type SveltePaginatedQueryArgs<Query extends PaginatedQueryReference> =
  | QueryArgsValue<PaginatedQueryArgs<Query>>
  | (() => QueryArgsValue<PaginatedQueryArgs<Query>>)

export type SvelteUseQueryOptions<
  Query extends FunctionReference<'query'>,
  Selected = FunctionReturnType<Query>,
  ThrowOnError extends boolean = false
> = Readonly<{
  initialData?: Selected
  keepPreviousData?: boolean
  onDataChange?: (
    change: Readonly<{ next: Selected; previous: Selected }>
  ) => void
  retries?: number
  select?: (data: FunctionReturnType<Query>) => Selected
  throwOnError?: ThrowOnError
}>

export type SvelteUseQueryResult<
  Data,
  ThrowOnError extends boolean = false
> = SvelteReactiveResult<
  | Exclude<SvelteQueryResult<Data>, SvelteQueryErrorResult>
  | (ThrowOnError extends true ? never : SvelteQueryErrorResult)
>

export type SvelteUsePaginatedQueryOptions<
  Query extends PaginatedQueryReference,
  ThrowOnError extends boolean = false
> = Readonly<{
  initialData?: PaginatedQueryItem<Query>[]
  initialNumItems: number
  keepPreviousData?: boolean
  onDataChange?: (
    change: Readonly<{
      next: PaginatedQueryItem<Query>[]
      previous: PaginatedQueryItem<Query>[]
    }>
  ) => void
  retries?: number
  throwOnError?: ThrowOnError
}>

export type SvelteUsePaginatedQueryResult<
  Item,
  ThrowOnError extends boolean = false
> = SvelteReactiveResult<UseQueryPaginationResult<Item, ThrowOnError>>

type SvelteReactiveResult<Result> = Result & Readonly<{ isStale: boolean }>

export type SvelteAuthProvider = Readonly<{
  fetchAccessToken: (options: {
    forceRefreshToken: boolean
  }) => Promise<string | null>
  isAuthenticated: boolean
  isLoading: boolean
}>

export type SvelteAuthProviderGetter = () => SvelteAuthProvider

export type SvelteSetupAuthOptions = Readonly<{
  initialState?: Readonly<{ isAuthenticated: boolean }>
}>
