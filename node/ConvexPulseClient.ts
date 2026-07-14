import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs
} from 'convex/server'
import { getFunctionName } from 'convex/server'
import type { GenericId, Value } from 'convex/values'

import { ActionDeduper } from '#client/ActionDeduper.js'
import { DevtoolsBridge } from '#client/Devtools.js'
import type { DevtoolsHandle } from '#client/Devtools.js'
import type {
  OptimisticPaginatedOperations,
  OptimisticQueryValue
} from '#client/Optimistic.js'
import { preparePaginatedQuery } from '#client/Pagination.js'
import type {
  PaginatedQueryArgs,
  PaginatedQueryHandle,
  PaginatedQueryItem,
  PaginatedQueryReference,
  UseQueryPaginationResult
} from '#client/Pagination.js'
import { QueryCore } from '#client/QueryCore.js'
import type {
  CoreOptimisticContext,
  CoreQueryHandle
} from '#client/QueryCore.js'
import { selectQueryHandle } from '#client/QuerySelector.js'
import { withRetries } from '#client/retries.js'
import { SyncClient, SyncClientClosedError } from '#client/SyncClient.js'
import type {
  SyncAuthOptions,
  SyncAuthTokenFetcher,
  SyncQuery,
  SyncQueryResult
} from '#client/SyncClient.js'
import { canonicalConvexValue, encodeConvexValue } from '#client/valueCodec.js'
import { WebSocketTransport } from '#client/WebSocketTransport.js'
import { SyncQueryStream } from '#node/SyncQueryStream.js'

/**
 * A client for subscribing to and invoking functions on a Convex deployment.
 *
 * @public
 */
export class ConvexPulseClient {
  readonly devtools: DevtoolsHandle
  readonly #actions = new ActionDeduper()
  readonly #sync: SyncClient
  readonly #core: QueryCore
  readonly #pendingQueries = new Set<PendingQuery>()
  readonly #streams = new Set<SyncQueryStream<unknown>>()
  #closed = false

  /**
   * Creates a client for a Convex deployment.
   *
   * @param url - The URL of the Convex deployment.
   */
  constructor(url: string, options: ConvexPulseClientOptions = {}) {
    this.#sync = new SyncClient(new WebSocketTransport(url))
    this.#core = new QueryCore(this.#sync, options)
    this.devtools = new DevtoolsBridge(this.#core, this.#sync)
    if (options.fetchToken !== undefined) {
      this.setAuth(options.fetchToken)
    }
  }

  /** Uses a JWT token provider for subsequent function calls and subscriptions. */
  setAuth(fetchToken: AuthTokenFetcher, options: AuthOptions = {}) {
    this.#actions.clear()
    this.#sync.setAuth(fetchToken, {
      ...options,
      onChange: (isAuthenticated) => {
        this.#core.resetAuthScope()
        options.onChange?.(isAuthenticated)
      }
    })
  }

  /** Returns the client to the anonymous identity. */
  clearAuth() {
    this.#actions.clear()
    this.#sync.clearAuth()
  }

  /** Executes a query once without retaining a live subscription. */
  query<
    Query extends FunctionReference<'query'>,
    Selected = FunctionReturnType<Query>
  >(query: Query, options: QueryOptions<Query, Selected>): Promise<Selected> {
    if (this.#closed) {
      return Promise.reject(new SyncClientClosedError())
    }
    const descriptor = ConvexPulseClient.#queryDescriptor(query, options.args)
    const pending: PendingQuery = {
      reject: ConvexPulseClient.#rejectUninitialized,
      release: ConvexPulseClient.#releaseUninitialized
    }

    function run(this: ConvexPulseClient) {
      return new Promise<FunctionReturnType<Query>>((resolve, reject) => {
        pending.reject = reject
        this.#pendingQueries.add(pending)
        pending.release = this.#sync.subscribe(descriptor, (result) => {
          pending.release()
          this.#pendingQueries.delete(pending)
          if (result.status === 'success') {
            resolve(result.value as FunctionReturnType<Query>)
          } else {
            reject(result.error)
          }
        })
      })
    }
    return withRetries(run.bind(this), options.retries).then((value) =>
      options.select === undefined
        ? (value as unknown as Selected)
        : options.select(value)
    )
  }

  /** Executes a mutation. */
  mutation<Mutation extends FunctionReference<'mutation'>>(
    mutation: Mutation,
    options: MutationOptions<Mutation>
  ): Promise<FunctionReturnType<Mutation>> {
    const path = getFunctionName(mutation)
    const dedupeValue = options.dedupe?.({ args: options.args })
    return this.#core.mutation(
      path,
      options.args,
      dedupeValue === undefined ? undefined : canonicalConvexValue(dedupeValue),
      options.optimistic === undefined
        ? undefined
        : (context) =>
            ConvexPulseClient.#runOptimisticUpdate(
              options.args,
              options.optimistic as (
                context: OptimisticMutationContext<Mutation>
              ) => void,
              context
            ),
      options.retries
    )
  }

  /** Executes an action. */
  action<Action extends FunctionReference<'action'>>(
    action: Action,
    options: ActionOptions<Action>
  ): Promise<FunctionReturnType<Action>> {
    const args = ConvexPulseClient.#encodedArgs(options.args)
    const path = getFunctionName(action)
    const dedupeValue = options.dedupe?.({ args: options.args })
    return this.#actions.run(path, dedupeValue, () =>
      withRetries(
        () =>
          this.#sync.action({ args, path }) as Promise<
            FunctionReturnType<Action>
          >,
        options.retries
      )
    )
  }

  /** Calls a listener whenever a query result changes. */
  onUpdate<Query extends FunctionReference<'query'>>(
    query: Query,
    options: Query extends PaginatedQueryReference
      ? QueryPaginationOptions<Query>
      : never,
    callback: (
      data: UseQueryPaginationResult<
        PaginatedQueryItem<Query & PaginatedQueryReference>
      >
    ) => void
  ): QuerySubscription<
    UseQueryPaginationResult<
      PaginatedQueryItem<Query & PaginatedQueryReference>
    >
  >
  onUpdate<
    Query extends FunctionReference<'query'>,
    Selected = FunctionReturnType<Query>
  >(
    query: Query,
    options: QueryOptions<Query, Selected>,
    callback: (data: Selected) => void
  ): QuerySubscription<Selected>
  onUpdate<Query extends FunctionReference<'query'>>(
    query: Query,
    options:
      | QueryOptions<Query, unknown>
      | QueryPaginationOptions<PaginatedQueryReference>,
    callback: (
      data: FunctionReturnType<Query> | UseQueryPaginationResult<unknown>
    ) => void
  ): QuerySubscription<
    FunctionReturnType<Query> | UseQueryPaginationResult<unknown>
  > {
    if ('pagination' in options) {
      const handle = this.#paginationHandle(
        query as PaginatedQueryReference,
        options
      )
      return ConvexPulseClient.#createSubscription(
        () => {
          const snapshot = handle.getSnapshot()
          if (snapshot.status === 'error') {
            return { error: snapshot.error, status: 'error' }
          }
          return snapshot.status === 'success' && !snapshot.isLoading
            ? { status: 'success', value: snapshot }
            : null
        },
        handle.subscribe,
        callback
      )
    }
    const handle = this.#queryHandle(
      query,
      options.args,
      options.select,
      options.retries
    )
    return ConvexPulseClient.#createSubscription(
      handle.getResult,
      handle.subscribeWithCurrent,
      callback
    )
  }

  /** Creates a live query watch. */
  watchQuery<Query extends FunctionReference<'query'>>(
    query: Query,
    options: Query extends PaginatedQueryReference
      ? QueryPaginationOptions<Query>
      : never
  ): AsyncIterable<
    UseQueryPaginationResult<
      PaginatedQueryItem<Query & PaginatedQueryReference>
    >
  >
  watchQuery<
    Query extends FunctionReference<'query'>,
    Selected = FunctionReturnType<Query>
  >(
    query: Query,
    options: QueryOptions<Query, Selected>
  ): AsyncIterable<Selected>
  watchQuery<Query extends FunctionReference<'query'>>(
    query: Query,
    options:
      | QueryOptions<Query, unknown>
      | QueryPaginationOptions<PaginatedQueryReference>
  ): AsyncIterable<
    FunctionReturnType<Query> | UseQueryPaginationResult<unknown>
  > {
    const paginated = 'pagination' in options
    const handle = paginated
      ? this.#paginationHandle(query as PaginatedQueryReference, options)
      : this.#queryHandle(query, options.args, options.select, options.retries)
    const stream = new SyncQueryStream<
      FunctionReturnType<Query> | UseQueryPaginationResult<unknown>
    >((receive) => {
      if (paginated) {
        return handle.subscribe(() => {
          const snapshot = (
            handle as PaginatedQueryHandle<unknown>
          ).getSnapshot()
          if (snapshot.status === 'success' && !snapshot.isLoading) {
            receive({ status: 'success', value: snapshot })
          }
        })
      }
      return ConvexPulseClient.#subscribeQuery(
        handle as CoreQueryHandle<unknown>,
        receive
      )
    }, this.#streamClosed.bind(this))
    this.#streams.add(stream as SyncQueryStream<unknown>)
    return stream
  }

  /** Permanently closes the client and its active subscriptions. */
  async close(): Promise<void> {
    if (this.#closed) {
      return
    }
    this.#closed = true
    this.#actions.clear()
    const error = new SyncClientClosedError()
    for (const pending of this.#pendingQueries) {
      pending.release()
      pending.reject(error)
    }
    this.#pendingQueries.clear()
    for (const stream of this.#streams) {
      stream.close()
    }
    this.#streams.clear()
    this.#core.close()
    await this.#sync.close()
  }

  #queryHandle<
    Query extends FunctionReference<'query'>,
    Selected = FunctionReturnType<Query>
  >(
    query: Query,
    args: Readonly<Record<string, unknown>>,
    select?: (data: FunctionReturnType<Query>) => Selected,
    retries?: number
  ) {
    const handle = this.#core.prepareQuery<FunctionReturnType<Query>>(
      getFunctionName(query),
      args,
      retries
    )
    return select === undefined ? handle : selectQueryHandle(handle, select)
  }

  #paginationHandle(
    query: PaginatedQueryReference,
    options: QueryPaginationOptions<PaginatedQueryReference>
  ) {
    return preparePaginatedQuery(
      (reference, args) =>
        this.#queryHandle(reference, args, undefined, options.retries),
      query,
      options.args,
      options.pagination.initialNumItems
    )
  }

  static #subscribeQuery<Data>(
    handle: CoreQueryHandle<Data>,
    listener: (result: SyncQueryResult) => void
  ) {
    return handle.subscribeWithCurrent(() => {
      const result = handle.getResult()
      if (result !== null) {
        listener(result)
      }
    })
  }

  static #createSubscription<Data>(
    getResult: () => SyncQueryResult | null,
    subscribe: (listener: () => void) => () => void,
    onValue: (value: Data) => void
  ): QuerySubscription<Data> {
    const errorListeners = new Set<(error: Error) => void>()
    let currentValue: Data | undefined
    let hasCurrentValue = false
    const release = subscribe(() => {
      const result = getResult()
      if (result?.status === 'success') {
        currentValue = result.value as Data
        hasCurrentValue = true
        onValue(currentValue)
      } else if (result?.status === 'error') {
        for (const listener of errorListeners) {
          listener(result.error)
        }
      }
    })

    function unsubscribe() {
      errorListeners.clear()
      release()
    }
    const subscription = unsubscribe as QuerySubscription<Data>
    subscription.unsubscribe = unsubscribe
    subscription.getCurrentValue = () => {
      const result = getResult()
      if (result?.status === 'error') {
        throw result.error
      }
      if (result?.status === 'success') {
        return result.value as Data
      }
      return hasCurrentValue ? currentValue : undefined
    }
    subscription.onError = (listener) => {
      errorListeners.add(listener)
      const result = getResult()
      if (result?.status === 'error') {
        listener(result.error)
      }
      return () => errorListeners.delete(listener)
    }
    return subscription
  }

  static #runOptimisticUpdate<Mutation extends FunctionReference<'mutation'>>(
    args: FunctionArgs<Mutation>,
    optimistic: (context: OptimisticMutationContext<Mutation>) => void,
    context: CoreOptimisticContext
  ) {
    const store = {
      get: (query, ...queryArgs) =>
        context.store.get(
          getFunctionName(query),
          (queryArgs[0] ?? {}) as Readonly<Record<string, unknown>>
        ),
      paginated: (query, queryArgs) =>
        context.store.paginated(getFunctionName(query), queryArgs)
    } as OptimisticStore
    optimistic({
      data: args,
      optimisticId: context.optimisticId as OptimisticId,
      store
    })
  }

  #streamClosed<Data>(stream: SyncQueryStream<Data>) {
    this.#streams.delete(stream as SyncQueryStream<unknown>)
  }

  static #queryDescriptor(
    reference: FunctionReference<'query'>,
    args: Readonly<Record<string, unknown>>
  ): SyncQuery {
    const path = getFunctionName(reference)
    return {
      args: ConvexPulseClient.#encodedArgs(args),
      key: JSON.stringify([path, canonicalConvexValue(args)]),
      path
    }
  }

  static #encodedArgs(args: Readonly<Record<string, unknown>>) {
    return encodeConvexValue(args) as Readonly<Record<string, unknown>>
  }

  /* v8 ignore next -- replaced synchronously inside the Promise executor */
  static #releaseUninitialized() {
    throw new Error('Pending query release was not initialized')
  }

  /* v8 ignore next -- replaced synchronously inside the Promise executor */
  static #rejectUninitialized(_error: unknown) {
    throw new Error('Pending query was not initialized')
  }
}

export type MutationOptions<Mutation extends FunctionReference<'mutation'>> =
  Readonly<{
    args: FunctionArgs<Mutation>
    dedupe?: (context: MutationDedupeContext<Mutation>) => Value
    optimistic?: (context: OptimisticMutationContext<Mutation>) => void
    retries?: number
  }>

export type ConvexPulseClientOptions = Readonly<{
  fetchToken?: AuthTokenFetcher
  gcTime?: number
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

export type ActionOptions<Action extends FunctionReference<'action'>> =
  Readonly<{
    args: FunctionArgs<Action>
    dedupe?: (context: ActionDedupeContext<Action>) => Value
    retries?: number
  }>

export type ActionDedupeContext<Action extends FunctionReference<'action'>> =
  Readonly<{
    args: Readonly<FunctionArgs<Action>>
  }>

export type QueryOptions<
  Query extends FunctionReference<'query'>,
  Selected = FunctionReturnType<Query>
> = Readonly<{
  args: FunctionArgs<Query>
  retries?: number
  select?: (data: FunctionReturnType<Query>) => Selected
}>

export type QueryPaginationOptions<Query extends PaginatedQueryReference> =
  Readonly<{
    args: PaginatedQueryArgs<Query>
    pagination: Readonly<{ initialNumItems: number }>
    retries?: number
  }>

export type QuerySubscription<Data> = (() => void) & {
  getCurrentValue: () => Data | undefined
  onError: (listener: (error: Error) => void) => () => void
  unsubscribe: () => void
}

export type AuthTokenFetcher = SyncAuthTokenFetcher

export type AuthOptions = SyncAuthOptions

type PendingQuery = {
  reject: (error: unknown) => void
  release: () => void
}
