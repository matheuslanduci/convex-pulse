import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs
} from 'convex/server'
import type { GenericId, Value } from 'convex/values'
import type { InjectionKey, MaybeRefOrGetter, ShallowRef } from 'vue'
import {
  computed,
  inject,
  onScopeDispose,
  provide,
  shallowRef,
  toValue,
  watch
} from 'vue'

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

export const ConvexPulseVueClientKey: InjectionKey<ConvexPulseVueClient> =
  Symbol('ConvexPulseVueClient')

export class ConvexPulseVueClient {
  readonly devtools: DevtoolsHandle
  readonly #client: FrameworkClient

  constructor(url: string, options: ConvexPulseVueClientOptions = {}) {
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
  ): VueQueryHandle<Selected> {
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

export function provideConvexPulse(client: ConvexPulseVueClient) {
  provide(ConvexPulseVueClientKey, client)
}

export function useQuery<
  Query extends FunctionReference<'query'>,
  Selected = FunctionReturnType<Query>,
  ThrowOnError extends boolean = false
>(
  query: Query,
  options: UseQueryOptions<Query, Selected, ThrowOnError> &
    Readonly<{ enabled?: never }>
): Readonly<ShallowRef<VueEnabledQueryResult<NoInfer<Selected>, ThrowOnError>>>
export function useQuery<
  Query extends FunctionReference<'query'>,
  ThrowOnError extends boolean = false
>(
  query: Query,
  options: Query extends PaginatedQueryReference
    ? UseQueryPaginationOptions<Query, ThrowOnError>
    : never
): Readonly<
  ShallowRef<
    UseQueryPaginationResult<
      PaginatedQueryItem<Query & PaginatedQueryReference>,
      ThrowOnError
    >
  >
>
export function useQuery<
  Query extends FunctionReference<'query'>,
  Selected = FunctionReturnType<Query>,
  ThrowOnError extends boolean = false
>(
  query: Query,
  options: UseQueryOptions<Query, Selected, ThrowOnError>
): Readonly<ShallowRef<VueQueryResult<Selected, ThrowOnError>>>
export function useQuery(
  query: FunctionReference<'query'>,
  options:
    | UseQueryOptions<FunctionReference<'query'>, unknown, boolean>
    | UseQueryPaginationOptions<PaginatedQueryReference, boolean>
): Readonly<ShallowRef<unknown>> {
  const client = useClient()
  const paginated = 'pagination' in options
  const select = 'select' in options ? options.select : undefined
  const disabledSnapshot = paginated
    ? getDisabledPaginationSnapshot
    : getDisabledQuerySnapshot
  const observer = new DataChangeObserver<unknown>(
    (options.onDataChange ?? noop) as OnDataChange<unknown>
  )
  const snapshot = shallowRef<
    VueQueryResult<unknown> | UseQueryPaginationResult<unknown>
  >(disabledSnapshot())
  let releaseQuery = noop
  const releaseEnabled = watch(
    () => {
      const args = toValue(options.args)
      const enabled = toValue(options.enabled ?? true) && args !== skipToken
      return {
        args,
        enabled,
        key: enabled ? JSON.stringify(canonicalConvexValue(args)) : null
      }
    },
    ({ args, enabled }) => {
      releaseQuery()
      releaseQuery = noop
      if (!enabled || args === skipToken) {
        snapshot.value = disabledSnapshot()
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
        : client.prepareQuery(query, args, select, options.retries)
      const current = handle.getSnapshot()
      observer.update(current as DataChangeResult<unknown>)
      snapshot.value = current
      releaseQuery = handle.subscribe(() => {
        const next = handle.getSnapshot()
        observer.update(next as DataChangeResult<unknown>)
        snapshot.value = next
      })
    },
    { immediate: true }
  )

  onScopeDispose(() => {
    releaseEnabled()
    releaseQuery()
  })

  return computed(() => {
    const current = snapshot.value
    if (options.throwOnError === true && current.status === 'error') {
      throw current.error
    }
    return current
  })
}

export function useOnDataChange<Data>(
  query: Readonly<ShallowRef<DataChangeResult<Data>>>,
  onDataChange: OnDataChange<Data>
) {
  const observer = new DataChangeObserver(onDataChange)
  const release = watch(
    () => query.value,
    (snapshot) => observer.update(snapshot),
    { immediate: true }
  )
  onScopeDispose(release)
}

function noop() {
  // A query that is not active has no subscription to release.
}

/** Creates a callable mutation with reactive, latest-invocation-wins state. */
export function useMutation<Mutation extends FunctionReference<'mutation'>>(
  mutation: Mutation,
  options?: UseMutationOptions<Mutation>
): UseMutationResult<Mutation> {
  const client = useClient()
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
  const snapshot = shallowRef(controller.getSnapshot())
  const release = controller.subscribe(() => {
    snapshot.value = controller.getSnapshot()
  })
  onScopeDispose(release)
  function execute(...args: OptionalRestArgs<Mutation>) {
    return controller.execute((args[0] ?? {}) as FunctionArgs<Mutation>)
  }

  return Object.defineProperties(execute, {
    data: { get: () => snapshot.value.data },
    error: { get: () => snapshot.value.error },
    isPending: { get: () => snapshot.value.isPending },
    reset: { value: controller.reset },
    status: { get: () => snapshot.value.status }
  }) as UseMutationResult<Mutation>
}

/** Creates a callable action with reactive lifecycle state. */
export function useAction<Action extends FunctionReference<'action'>>(
  action: Action,
  options?: UseActionOptions<Action>
): UseActionResult<Action> {
  const client = useClient()
  const controller = createActionController<Action>(
    (args, retries, dedupeValue) =>
      client.action(action, args, retries, dedupeValue),
    options
  )
  const snapshot = shallowRef(controller.getSnapshot())
  const release = controller.subscribe(() => {
    snapshot.value = controller.getSnapshot()
  })
  onScopeDispose(release)

  return Object.defineProperties(createActionExecutor(controller), {
    data: { get: () => snapshot.value.data },
    error: { get: () => snapshot.value.error },
    isPending: { get: () => snapshot.value.isPending },
    reset: { value: controller.reset },
    status: { get: () => snapshot.value.status }
  }) as UseActionResult<Action>
}

export function usePrefetchQuery<Query extends FunctionReference<'query'>>(
  query: Query
): PrefetchQuery<Query> {
  const client = useClient()

  return (...args) =>
    client.prefetch(query, (args[0] ?? {}) as FunctionArgs<Query>)
}

function useClient() {
  const client = inject(ConvexPulseVueClientKey)

  if (client === undefined) {
    throw new Error('Convex Pulse Vue client was not provided')
  }

  return client
}

export type VueQueryHandle<Data> = Readonly<{
  getSnapshot: () => VueQueryResult<Data>
  subscribe: (listener: () => void) => () => void
}>

export type UseActionOptions<Action extends FunctionReference<'action'>> =
  FrameworkActionOptions<Action>

export type UseActionResult<Action extends FunctionReference<'action'>> =
  FrameworkActionResult<Action>

export type {
  ActionErrorResult,
  ActionIdleResult,
  ActionPendingResult,
  ActionResult,
  ActionSuccessResult
} from '#client/ActionState.js'

export type VueQueryResult<Data, ThrowOnError extends boolean = false> =
  | FrameworkQueryDisabledResult
  | VueQueryPendingResult
  | (ThrowOnError extends true ? never : VueQueryErrorResult)
  | VueQuerySuccessResult<Data>

export type VueEnabledQueryResult<
  Data,
  ThrowOnError extends boolean = false
> = Exclude<VueQueryResult<Data, ThrowOnError>, FrameworkQueryDisabledResult>

export type VueQueryPendingResult = Readonly<{
  data: undefined
  error: null
  isLoading: true
  status: 'pending'
}>

export type VueQueryErrorResult = Readonly<{
  data: undefined
  error: Error
  isLoading: false
  status: 'error'
}>

export type VueQuerySuccessResult<Data> = Readonly<{
  data: Data
  error: null
  isLoading: false
  status: 'success'
}>

export type UseQueryOptions<
  Query extends FunctionReference<'query'>,
  Selected = FunctionReturnType<Query>,
  ThrowOnError extends boolean = false
> = Readonly<{
  args: VueQueryArgs<FunctionArgs<Query>>
  enabled?: QueryEnabled
  onDataChange?: OnDataChange<Selected>
  retries?: number
  select?: (data: FunctionReturnType<Query>) => Selected
  throwOnError?: ThrowOnError
}>

export type UseQueryPaginationOptions<
  Query extends PaginatedQueryReference,
  ThrowOnError extends boolean = false
> = Readonly<{
  args: VueQueryArgs<PaginatedQueryArgs<Query>>
  enabled?: QueryEnabled
  onDataChange?: OnDataChange<PaginatedQueryItem<Query>[]>
  pagination: Readonly<{ initialNumItems: number }>
  retries?: number
  throwOnError?: ThrowOnError
}>

export type VueQueryArgs<Args extends Readonly<Record<string, unknown>>> =
  MaybeRefOrGetter<QueryArgs<Args>>

export type UseMutationResult<Mutation extends FunctionReference<'mutation'>> =
  MutationExecutor<Mutation> & MutationResult<FunctionReturnType<Mutation>>

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

export type UseMutationOptions<Mutation extends FunctionReference<'mutation'>> =
  Readonly<{
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

export type ConvexPulseVueClientOptions = FrameworkClientOptions

export type { DataChange, OnDataChange } from '#client/DataChange.js'

export type QueryEnabled = MaybeRefOrGetter<boolean>

type MutationExecutor<Mutation extends FunctionReference<'mutation'>> = (
  ...args: OptionalRestArgs<Mutation>
) => Promise<FunctionReturnType<Mutation>>
