import type { Signal } from '@angular/core'
import {
  DestroyRef,
  InjectionToken,
  computed,
  inject,
  signal
} from '@angular/core'
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs
} from 'convex/server'
import type { GenericId, Value } from 'convex/values'

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

export { skipToken } from '#client/QueryOptions.js'

export const CONVEX_PULSE_CLIENT = new InjectionToken<ConvexPulseAngularClient>(
  'CONVEX_PULSE_CLIENT'
)

export class ConvexPulseAngularClient {
  readonly devtools: DevtoolsHandle
  readonly #client: FrameworkClient

  constructor(url: string, options: ConvexPulseAngularClientOptions = {}) {
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
  ): AngularQueryHandle<Selected> {
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

export function injectQuery<
  Query extends FunctionReference<'query'>,
  Selected = FunctionReturnType<Query>,
  ThrowOnError extends boolean = false
>(
  query: Query,
  options: InjectQueryOptions<Query, Selected, ThrowOnError>
): AngularQuerySignal<AngularQueryResult<Selected, ThrowOnError>>
export function injectQuery<
  Query extends FunctionReference<'query'>,
  ThrowOnError extends boolean = false
>(
  query: Query,
  options: Query extends PaginatedQueryReference
    ? InjectQueryPaginationOptions<Query, ThrowOnError>
    : never
): AngularQuerySignal<
  UseQueryPaginationResult<
    PaginatedQueryItem<Query & PaginatedQueryReference>,
    ThrowOnError
  >
>
export function injectQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  options:
    | InjectQueryOptions<Query, unknown, boolean>
    | InjectQueryPaginationOptions<PaginatedQueryReference, boolean>
) {
  const client = inject(CONVEX_PULSE_CLIENT)
  const paginated = 'pagination' in options
  const select = 'select' in options ? options.select : undefined
  const disabledSnapshot = paginated
    ? getDisabledPaginationSnapshot
    : getDisabledQuerySnapshot
  const observer = new DataChangeObserver<unknown>(
    (options.onDataChange ?? noop) as OnDataChange<unknown>
  )
  const snapshot = signal<
    AngularQueryResult<unknown> | UseQueryPaginationResult<unknown>
  >(disabledSnapshot())
  let currentSnapshot:
    | AngularQueryResult<unknown>
    | UseQueryPaginationResult<unknown> = disabledSnapshot()
  const listeners = new Set<() => void>()
  let activeKey: string | null = null
  let release = noop

  function updateSubscription() {
    const args = resolveQueryArgs(options.args)
    const enabled = queryIsEnabled(options.enabled) && args !== skipToken
    const nextKey = enabled ? JSON.stringify(canonicalConvexValue(args)) : null
    if (nextKey === activeKey) {
      return
    }

    activeKey = nextKey
    release()
    release = noop
    if (!enabled || args === skipToken) {
      currentSnapshot = disabledSnapshot()
      return
    }

    const handle = paginated
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
    const current = handle.getSnapshot()
    observer.update(current as DataChangeResult<unknown>)
    currentSnapshot = current
    release = handle.subscribe(() => {
      const next = handle.getSnapshot()
      observer.update(next as DataChangeResult<unknown>)
      currentSnapshot = next
      snapshot.set(next)
      for (const listener of listeners) {
        listener()
      }
    })
  }

  updateSubscription()
  inject(DestroyRef).onDestroy(() => release())

  const result = computed(() => {
    snapshot()
    updateSubscription()
    const current = currentSnapshot
    if (options.throwOnError === true && current.status === 'error') {
      throw current.error
    }
    return current
  })
  return Object.assign(result, {
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  })
}

function resolveQueryArgs<Args extends Readonly<Record<string, unknown>>>(
  args: AngularQueryArgs<Args>
) {
  return typeof args === 'function' ? args() : args
}

export function injectOnDataChange<Data>(
  query: AngularQuerySignal<DataChangeResult<Data>>,
  onDataChange: OnDataChange<Data>
) {
  const observer = new DataChangeObserver(onDataChange)
  observer.update(query())
  const release = query.subscribe(() => observer.update(query()))
  inject(DestroyRef).onDestroy(release)
}

function queryIsEnabled(enabled: QueryEnabled | undefined) {
  return typeof enabled === 'function' ? enabled() : (enabled ?? true)
}

function noop() {
  // A query that is not active has no subscription to release.
}

/** Injects a callable mutation with signal-backed observable state. */
export function injectMutation<Mutation extends FunctionReference<'mutation'>>(
  mutation: Mutation,
  options?: InjectMutationOptions<Mutation>
): InjectMutationResult<Mutation> {
  const client = inject(CONVEX_PULSE_CLIENT)
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
  const snapshot = signal(controller.getSnapshot())
  const release = controller.subscribe(() =>
    snapshot.set(controller.getSnapshot())
  )
  inject(DestroyRef).onDestroy(release)
  function execute(...args: OptionalRestArgs<Mutation>) {
    return controller.execute((args[0] ?? {}) as FunctionArgs<Mutation>)
  }

  return Object.defineProperties(execute, {
    data: { get: () => snapshot().data },
    error: { get: () => snapshot().error },
    isPending: { get: () => snapshot().isPending },
    reset: { value: controller.reset },
    status: { get: () => snapshot().status }
  }) as InjectMutationResult<Mutation>
}

/** Injects a callable action with signal-backed observable state. */
export function injectAction<Action extends FunctionReference<'action'>>(
  action: Action,
  options?: InjectActionOptions<Action>
): InjectActionResult<Action> {
  const client = inject(CONVEX_PULSE_CLIENT)
  const controller = createActionController<Action>(
    (args, retries, dedupeValue) =>
      client.action(action, args, retries, dedupeValue),
    options
  )
  const snapshot = signal(controller.getSnapshot())
  const release = controller.subscribe(() =>
    snapshot.set(controller.getSnapshot())
  )
  inject(DestroyRef).onDestroy(release)

  return Object.defineProperties(createActionExecutor(controller), {
    data: { get: () => snapshot().data },
    error: { get: () => snapshot().error },
    isPending: { get: () => snapshot().isPending },
    reset: { value: controller.reset },
    status: { get: () => snapshot().status }
  }) as InjectActionResult<Action>
}

export function injectPrefetchQuery<Query extends FunctionReference<'query'>>(
  query: Query
): PrefetchQuery<Query> {
  const client = inject(CONVEX_PULSE_CLIENT)

  return (...args) =>
    client.prefetch(query, (args[0] ?? {}) as FunctionArgs<Query>)
}

export type AngularQueryHandle<Data> = Readonly<{
  getSnapshot: () => AngularQueryResult<Data>
  subscribe: (listener: () => void) => () => void
}>

export type AngularQuerySignal<Result> = Signal<Result> &
  Readonly<{ subscribe: (listener: () => void) => () => void }>

export type AngularQueryResult<Data, ThrowOnError extends boolean = false> =
  | FrameworkQueryDisabledResult
  | AngularQueryPendingResult
  | (ThrowOnError extends true ? never : AngularQueryErrorResult)
  | AngularQuerySuccessResult<Data>

export type AngularQueryPendingResult = Readonly<{
  data: undefined
  error: null
  isLoading: true
  status: 'pending'
}>

export type AngularQueryErrorResult = Readonly<{
  data: undefined
  error: Error
  isLoading: false
  status: 'error'
}>

export type AngularQuerySuccessResult<Data> = Readonly<{
  data: Data
  error: null
  isLoading: false
  status: 'success'
}>

export type InjectQueryOptions<
  Query extends FunctionReference<'query'>,
  Selected = FunctionReturnType<Query>,
  ThrowOnError extends boolean = false
> = Readonly<{
  args: AngularQueryArgs<FunctionArgs<Query>>
  enabled?: QueryEnabled
  onDataChange?: OnDataChange<Selected>
  retries?: number
  select?: (data: FunctionReturnType<Query>) => Selected
  throwOnError?: ThrowOnError
}>

export type InjectQueryPaginationOptions<
  Query extends PaginatedQueryReference,
  ThrowOnError extends boolean = false
> = Readonly<{
  args: AngularQueryArgs<PaginatedQueryArgs<Query>>
  enabled?: QueryEnabled
  onDataChange?: OnDataChange<PaginatedQueryItem<Query>[]>
  pagination: Readonly<{ initialNumItems: number }>
  retries?: number
  throwOnError?: ThrowOnError
}>

export type AngularQueryArgs<Args extends Readonly<Record<string, unknown>>> =
  | QueryArgs<Args>
  | Signal<QueryArgs<Args>>
  | (() => QueryArgs<Args>)

export type InjectMutationResult<
  Mutation extends FunctionReference<'mutation'>
> = MutationExecutor<Mutation> & MutationResult<FunctionReturnType<Mutation>>

export type InjectActionOptions<Action extends FunctionReference<'action'>> =
  FrameworkActionOptions<Action>

export type InjectActionResult<Action extends FunctionReference<'action'>> =
  FrameworkActionResult<Action>

export type {
  ActionErrorResult,
  ActionIdleResult,
  ActionPendingResult,
  ActionResult,
  ActionSuccessResult
} from '#client/ActionState.js'

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

export type InjectMutationOptions<
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

export type PrefetchHandle<Data> = Readonly<{
  cancel: () => void
  ready: Promise<Data>
}>

export type AuthTokenFetcher = FrameworkAuthTokenFetcher

export type AuthOptions = FrameworkAuthOptions

export type ConvexPulseAngularClientOptions = FrameworkClientOptions

export type { DataChange, OnDataChange } from '#client/DataChange.js'

export type QueryEnabled = boolean | Signal<boolean>
