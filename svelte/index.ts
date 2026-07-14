/* oxlint-disable import/no-cycle -- rune and lifecycle modules build on this public entrypoint */
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs
} from 'convex/server'
import { makeFunctionReference } from 'convex/server'
import type { GenericId, Value } from 'convex/values'
import type { Readable } from 'svelte/store'
import { readable } from 'svelte/store'

import {
  createActionController,
  createActionExecutor
} from '#client/ActionState.js'
import type {
  FrameworkActionOptions,
  FrameworkActionResult
} from '#client/ActionState.js'
import { DataChangeObserver } from '#client/DataChange.js'
import type { DataChangeResult, OnDataChange } from '#client/DataChange.js'
import type { DevtoolsHandle } from '#client/Devtools.js'
import {
  FrameworkClient,
  getDisabledQuerySnapshot
} from '#client/FrameworkClient.js'
import type {
  FrameworkAuthOptions,
  FrameworkAuthTokenFetcher,
  FrameworkClientOptions,
  FrameworkQueryDisabledResult
} from '#client/FrameworkClient.js'
import { MutationController } from '#client/MutationState.js'
import type {
  MutationContext,
  MutationErrorContext,
  MutationErrorSnapshot,
  MutationIdleSnapshot,
  MutationPendingSnapshot,
  MutationSettledContext,
  MutationSnapshot,
  MutationSuccessContext,
  MutationSuccessSnapshot
} from '#client/MutationState.js'
import type {
  OptimisticPaginatedOperations,
  OptimisticQueryValue
} from '#client/Optimistic.js'
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
import { preloadedQueryArgs, preloadedQueryResult } from '#http/index.js'
import type { PreloadedQuery } from '#http/index.js'
import { getConvexClient } from '#svelte/lifecycle.js'

export { skipToken } from '#client/QueryOptions.js'
export {
  closeConvex,
  getConvexClient,
  initConvex,
  setConvexClientContext,
  setupConvex,
  useConvexClient
} from '#svelte/lifecycle.js'
export type { SvelteAuthContext } from '#svelte/lifecycle.js'
export {
  setupAuth,
  useAuth,
  usePaginatedQuery,
  useQuery
} from '#svelte/reactive.svelte.js'
export type {
  SvelteAuthProvider,
  SvelteAuthProviderGetter,
  SveltePaginatedQueryArgs,
  SvelteQueryArgs,
  SvelteSetupAuthOptions,
  SvelteUsePaginatedQueryOptions,
  SvelteUsePaginatedQueryResult,
  SvelteUseQueryOptions,
  SvelteUseQueryResult
} from '#svelte/reactive.svelte.js'

export class ConvexPulseSvelteClient {
  readonly devtools: DevtoolsHandle
  readonly #client: FrameworkClient

  constructor(url: string, options: ConvexPulseSvelteClientOptions = {}) {
    this.#client = new FrameworkClient(url, options)
    this.devtools = this.#client.devtools
  }

  setAuth(fetchToken: AuthTokenFetcher, options: AuthOptions = {}) {
    this.#client.setAuth(fetchToken, options)
  }

  clearAuth() {
    this.#client.clearAuth()
  }

  action<Action extends FunctionReference<'action'>>(
    action: Action,
    args: FunctionArgs<Action>,
    retries?: number,
    dedupeValue?: Value
  ): Promise<FunctionReturnType<Action>> {
    return this.#client.action(action, args, retries, dedupeValue)
  }

  prepareQuery<
    Query extends FunctionReference<'query'>,
    Selected = FunctionReturnType<Query>
  >(
    query: Query,
    args: FunctionArgs<Query>,
    select?: (data: FunctionReturnType<Query>) => Selected,
    retries?: number
  ): SvelteQueryHandle<Selected> {
    return this.#client.prepareQuery(query, args, select, retries)
  }

  mutation<Mutation extends FunctionReference<'mutation'>>(
    mutation: Mutation,
    args: FunctionArgs<Mutation>,
    dedupeKey?: string,
    optimistic?: (context: OptimisticMutationContext<Mutation>) => void,
    retries?: number
  ): Promise<FunctionReturnType<Mutation>> {
    return this.#client.mutation(mutation, args, dedupeKey, optimistic, retries)
  }

  prefetch<Query extends FunctionReference<'query'>>(
    query: Query,
    args: FunctionArgs<Query>
  ): PrefetchHandle<FunctionReturnType<Query>> {
    return this.#client.prefetch(query, args)
  }

  async close(): Promise<void> {
    await this.#client.close()
  }
}

export function createQuery<Query extends PaginatedQueryReference>(
  client: ConvexPulseSvelteClient,
  query: Query,
  options: CreateQueryPaginationOptions<Query>
): Readable<UseQueryPaginationResult<PaginatedQueryItem<Query>>>
export function createQuery<
  Query extends FunctionReference<'query'>,
  Selected = FunctionReturnType<Query>
>(
  client: ConvexPulseSvelteClient,
  query: Query,
  options: CreateQueryOptions<Query, Selected> & Readonly<{ enabled?: never }>
): Readable<SvelteEnabledQueryResult<NoInfer<Selected>>>
export function createQuery<
  Query extends FunctionReference<'query'>,
  Selected = FunctionReturnType<Query>
>(
  client: ConvexPulseSvelteClient,
  query: Query,
  options: CreateQueryOptions<Query, Selected>
): Readable<SvelteQueryResult<Selected>>
export function createQuery<Query extends FunctionReference<'query'>>(
  client: ConvexPulseSvelteClient,
  query: Query,
  options:
    | CreateQueryOptions<Query>
    | CreateQueryPaginationOptions<PaginatedQueryReference>
) {
  const paginated = 'pagination' in options
  const select = 'select' in options ? options.select : undefined
  const skipped = options.args === skipToken
  const args = skipped ? {} : options.args
  const handle = (() => {
    if (skipped) {
      return null
    }
    return paginated
      ? preparePaginatedQuery(
          (reference, pageArgs) =>
            client.prepareQuery(
              reference,
              pageArgs,
              undefined,
              options.retries
            ),
          query as PaginatedQueryReference,
          args as PaginatedQueryArgs<PaginatedQueryReference>,
          options.pagination.initialNumItems
        )
      : client.prepareQuery(
          query,
          args as FunctionArgs<Query>,
          select,
          options.retries
        )
  })()
  const disabledSnapshot = paginated
    ? getDisabledPaginationSnapshot
    : getDisabledQuerySnapshot
  const observer = new DataChangeObserver<unknown>(
    (options.onDataChange ?? noop) as OnDataChange<unknown>
  )

  return readable<
    SvelteQueryResult<unknown> | UseQueryPaginationResult<unknown>
  >(disabledSnapshot(), (set) => {
    let releaseQuery = noop

    function updateEnabled(enabled: boolean) {
      releaseQuery()
      releaseQuery = noop
      if (!enabled || skipped) {
        set(disabledSnapshot())
        return
      }

      const current = handle?.getSnapshot() ?? disabledSnapshot()
      observer.update(current as DataChangeResult<unknown>)
      set(current)
      releaseQuery =
        handle?.subscribe(() => {
          const next = handle.getSnapshot()
          observer.update(next as DataChangeResult<unknown>)
          set(next)
        }) ?? noop
    }
    const releaseEnabled =
      typeof options.enabled === 'object'
        ? options.enabled.subscribe(updateEnabled)
        : (updateEnabled(options.enabled ?? true), noop)

    return () => {
      releaseEnabled()
      releaseQuery()
    }
  })
}

export function onDataChange<Data>(
  query: Readable<DataChangeResult<Data>>,
  listener: OnDataChange<Data>
) {
  const observer = new DataChangeObserver(listener)
  return query.subscribe((snapshot) => observer.update(snapshot))
}

function noop() {
  // A query that is not active has no subscription to release.
}

/** Creates a callable mutation that is also a readable lifecycle-state store. */
export function createMutation<Mutation extends FunctionReference<'mutation'>>(
  client: ConvexPulseSvelteClient,
  mutation: Mutation,
  options?: CreateMutationOptions<Mutation>
): CreateMutationResult<Mutation> {
  const controller = new MutationController<
    FunctionArgs<Mutation>,
    FunctionReturnType<Mutation>
  >({
    mutation: (args) => {
      const dedupeValue = options?.dedupe?.({ args })
      const dedupeKey =
        dedupeValue === undefined
          ? undefined
          : JSON.stringify(canonicalConvexValue(dedupeValue))
      return client.mutation(
        mutation,
        args,
        dedupeKey,
        options?.optimistic,
        options?.retries
      )
    },
    onError: (context) => options?.onError?.(context),
    onMutate: (context) => options?.onMutate?.(context),
    onSettled: (context) => options?.onSettled?.(context),
    onSuccess: (context) => options?.onSuccess?.(context)
  })
  function execute(...args: OptionalRestArgs<Mutation>) {
    return controller.execute((args[0] ?? {}) as FunctionArgs<Mutation>)
  }

  return Object.defineProperties(execute, {
    data: { get: () => controller.getSnapshot().data },
    error: { get: () => controller.getSnapshot().error },
    isPending: { get: () => controller.getSnapshot().isPending },
    reset: { value: controller.reset },
    status: { get: () => controller.getSnapshot().status },
    subscribe: {
      value: (
        run: (snapshot: MutationSnapshot<FunctionReturnType<Mutation>>) => void
      ) => {
        run(controller.getSnapshot())
        return controller.subscribe(() => run(controller.getSnapshot()))
      }
    }
  }) as CreateMutationResult<Mutation>
}

/** Creates a callable action that is also a readable lifecycle-state store. */
export function createAction<Action extends FunctionReference<'action'>>(
  client: ConvexPulseSvelteClient,
  action: Action,
  options?: CreateActionOptions<Action>
): CreateActionResult<Action> {
  const controller = createActionController<Action>(
    (args, retries, dedupeValue) =>
      client.action(action, args, retries, dedupeValue),
    options
  )

  return Object.defineProperties(createActionExecutor(controller), {
    data: { get: () => controller.getSnapshot().data },
    error: { get: () => controller.getSnapshot().error },
    isPending: { get: () => controller.getSnapshot().isPending },
    reset: { value: controller.reset },
    status: { get: () => controller.getSnapshot().status },
    subscribe: {
      value: (
        run: (snapshot: MutationSnapshot<FunctionReturnType<Action>>) => void
      ) => {
        run(controller.getSnapshot())
        return controller.subscribe(() => run(controller.getSnapshot()))
      }
    }
  }) as CreateActionResult<Action>
}

export function createPrefetchQuery<Query extends FunctionReference<'query'>>(
  client: ConvexPulseSvelteClient,
  query: Query
): PrefetchQuery<Query> {
  return (...args) =>
    client.prefetch(query, (args[0] ?? {}) as FunctionArgs<Query>)
}

export function useMutation<Mutation extends FunctionReference<'mutation'>>(
  mutation: Mutation,
  options?: CreateMutationOptions<Mutation>
) {
  return createMutation(getConvexClient(), mutation, options)
}

export function useAction<Action extends FunctionReference<'action'>>(
  action: Action,
  options?: CreateActionOptions<Action>
) {
  return createAction(getConvexClient(), action, options)
}

export function usePrefetchQuery<Query extends FunctionReference<'query'>>(
  query: Query
) {
  return createPrefetchQuery(getConvexClient(), query)
}

/** Hydrates a server-fetched query and keeps it live after subscription. */
export function createPreloadedQuery<Query extends FunctionReference<'query'>>(
  client: ConvexPulseSvelteClient,
  preloaded: PreloadedQuery<Query>
): Readable<SvelteEnabledQueryResult<FunctionReturnType<Query>>> {
  const initialValue = preloadedQueryResult(preloaded)
  const query = createQuery(
    client,
    makeFunctionReference(preloaded._name) as Query,
    { args: preloadedQueryArgs(preloaded) }
  )

  return readable<SvelteEnabledQueryResult<FunctionReturnType<Query>>>(
    successQuerySnapshot(initialValue),
    (set) =>
      query.subscribe((snapshot) => {
        if (snapshot.status === 'pending') {
          set(successQuerySnapshot(initialValue))
          return
        }
        set(snapshot)
      })
  )
}

function successQuerySnapshot<Data>(
  data: Data
): SvelteQuerySuccessResult<Data> {
  return { data, error: null, isLoading: false, status: 'success' }
}

export type SvelteQueryHandle<Data> = Readonly<{
  getSnapshot: () => SvelteQueryResult<Data>
  subscribe: (listener: () => void) => () => void
}>

export type SvelteQueryResult<Data> =
  | FrameworkQueryDisabledResult
  | SvelteQueryPendingResult
  | SvelteQueryErrorResult
  | SvelteQuerySuccessResult<Data>

export type SvelteEnabledQueryResult<Data> = Exclude<
  SvelteQueryResult<Data>,
  FrameworkQueryDisabledResult
>

export type SvelteQueryPendingResult = Readonly<{
  data: undefined
  error: null
  isLoading: true
  status: 'pending'
}>

export type SvelteQueryErrorResult = Readonly<{
  data: undefined
  error: Error
  isLoading: false
  status: 'error'
}>

export type SvelteQuerySuccessResult<Data> = Readonly<{
  data: Data
  error: null
  isLoading: false
  status: 'success'
}>

export type CreateQueryOptions<
  Query extends FunctionReference<'query'>,
  Selected = FunctionReturnType<Query>
> = Readonly<{
  args: QueryArgs<FunctionArgs<Query>>
  enabled?: QueryEnabled
  onDataChange?: OnDataChange<Selected>
  retries?: number
  select?: (data: FunctionReturnType<Query>) => Selected
}>

export type CreateQueryPaginationOptions<
  Query extends PaginatedQueryReference
> = Readonly<{
  args: QueryArgs<PaginatedQueryArgs<Query>>
  enabled?: QueryEnabled
  onDataChange?: OnDataChange<PaginatedQueryItem<Query>[]>
  pagination: Readonly<{ initialNumItems: number }>
  retries?: number
}>

export type CreateActionOptions<Action extends FunctionReference<'action'>> =
  FrameworkActionOptions<Action>

export type CreateActionResult<Action extends FunctionReference<'action'>> =
  FrameworkActionResult<Action> &
    Readable<MutationSnapshot<FunctionReturnType<Action>>>

export type {
  ActionErrorResult,
  ActionIdleResult,
  ActionPendingResult,
  ActionResult,
  ActionSuccessResult
} from '#client/ActionState.js'

export type { DataChange, OnDataChange } from '#client/DataChange.js'

export type CreateMutationResult<
  Mutation extends FunctionReference<'mutation'>
> = MutationExecutor<Mutation> &
  MutationResult<FunctionReturnType<Mutation>> &
  Readable<MutationSnapshot<FunctionReturnType<Mutation>>>

export type MutationResult<Data> = MutationSnapshot<Data> &
  Readonly<{ reset: () => void }>

export type MutationIdleResult = MutationIdleSnapshot &
  Readonly<{ reset: () => void }>

export type MutationPendingResult = MutationPendingSnapshot &
  Readonly<{ reset: () => void }>

export type MutationErrorResult = MutationErrorSnapshot &
  Readonly<{ reset: () => void }>

export type MutationSuccessResult<Data> = MutationSuccessSnapshot<Data> &
  Readonly<{ reset: () => void }>

type MutationExecutor<Mutation extends FunctionReference<'mutation'>> = (
  ...args: OptionalRestArgs<Mutation>
) => Promise<FunctionReturnType<Mutation>>

export type CreateMutationOptions<
  Mutation extends FunctionReference<'mutation'>
> = Readonly<{
  dedupe?: (context: MutationDedupeContext<Mutation>) => Value
  onError?: (context: MutationErrorContext<FunctionArgs<Mutation>>) => void
  onMutate?: (context: MutationContext<FunctionArgs<Mutation>>) => void
  onSettled?: (
    context: MutationSettledContext<
      FunctionArgs<Mutation>,
      FunctionReturnType<Mutation>
    >
  ) => void
  onSuccess?: (
    context: MutationSuccessContext<
      FunctionArgs<Mutation>,
      FunctionReturnType<Mutation>
    >
  ) => void
  optimistic?: (context: OptimisticMutationContext<Mutation>) => void
  retries?: number
}>

export type MutationDedupeContext<
  Mutation extends FunctionReference<'mutation'>
> = Readonly<{
  args: Readonly<FunctionArgs<Mutation>>
}>

export type OptimisticMutationContext<
  Mutation extends FunctionReference<'mutation'>
> = Readonly<{
  data: Readonly<FunctionArgs<Mutation>>
  optimisticId: OptimisticId
  store: OptimisticStore
}>

export type OptimisticId = GenericId<never>

export type OptimisticStore = Readonly<{
  get: <Query extends FunctionReference<'query'>>(
    query: Query,
    ...args: OptionalRestArgs<Query>
  ) => OptimisticQuery<FunctionReturnType<Query>>
  paginated: <Query extends PaginatedQueryReference>(
    query: Query,
    args: PaginatedQueryArgs<Query>
  ) => OptimisticPaginatedOperations<PaginatedQueryItem<Query>>
}>

export type OptimisticQuery<QueryValue> = OptimisticQueryValue<QueryValue>

export type PrefetchQuery<Query extends FunctionReference<'query'>> = (
  ...args: OptionalRestArgs<Query>
) => PrefetchHandle<FunctionReturnType<Query>>

export type { PreloadedQuery } from '#http/index.js'

export type PrefetchHandle<Data> = Readonly<{
  cancel: () => void
  ready: Promise<Data>
}>

export type AuthTokenFetcher = FrameworkAuthTokenFetcher

export type AuthOptions = FrameworkAuthOptions

export type ConvexPulseSvelteClientOptions = FrameworkClientOptions

export type QueryEnabled = boolean | Readable<boolean>
