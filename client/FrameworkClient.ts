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
import { DormantTransport } from '#client/DormantTransport.js'
import type {
  OptimisticPaginatedOperations,
  OptimisticQueryValue
} from '#client/Optimistic.js'
import type {
  PaginatedQueryArgs,
  PaginatedQueryItem,
  PaginatedQueryReference
} from '#client/Pagination.js'
import { QueryCore } from '#client/QueryCore.js'
import type {
  CoreOptimisticContext,
  CoreQueryHandle
} from '#client/QueryCore.js'
import { selectQueryHandle } from '#client/QuerySelector.js'
import { withRetries } from '#client/retries.js'
import { SyncClient } from '#client/SyncClient.js'
import type {
  SyncAuthOptions,
  SyncAuthTokenFetcher
} from '#client/SyncClient.js'
import { encodeConvexValue } from '#client/valueCodec.js'
import { WebSocketTransport } from '#client/WebSocketTransport.js'

export class FrameworkClient {
  readonly devtools: DevtoolsHandle
  readonly #actions = new ActionDeduper()
  readonly #sync: SyncClient
  readonly #core: QueryCore

  constructor(url: string, options: FrameworkClientOptions = {}) {
    const transport = FrameworkClient.#canConnect()
      ? new WebSocketTransport(url)
      : new DormantTransport()
    this.#sync = new SyncClient(transport)
    this.#core = new QueryCore(this.#sync, options)
    this.devtools = new DevtoolsBridge(this.#core, this.#sync)
    if (options.fetchToken !== undefined) {
      this.setAuth(options.fetchToken)
    }
  }

  setAuth(
    fetchToken: FrameworkAuthTokenFetcher,
    options: FrameworkAuthOptions = {}
  ) {
    this.#actions.clear()
    this.#sync.setAuth(fetchToken, {
      ...options,
      onChange: (isAuthenticated) => {
        this.#core.resetAuthScope()
        options.onChange?.(isAuthenticated)
      }
    })
  }

  clearAuth() {
    this.#actions.clear()
    this.#sync.clearAuth()
  }

  prepareQuery<
    Query extends FunctionReference<'query'>,
    Selected = FunctionReturnType<Query>
  >(
    query: Query,
    args: FunctionArgs<Query>,
    select?: (data: FunctionReturnType<Query>) => Selected,
    retries?: number
  ): FrameworkQueryHandle<Selected> {
    const handle = this.#core.prepareQuery<FunctionReturnType<Query>>(
      getFunctionName(query),
      args,
      retries
    )
    return select === undefined
      ? (handle as FrameworkQueryHandle<Selected>)
      : selectQueryHandle(handle, select)
  }

  mutation<Mutation extends FunctionReference<'mutation'>>(
    mutation: Mutation,
    args: FunctionArgs<Mutation>,
    dedupeKey?: string,
    optimistic?: (context: FrameworkOptimisticContext<Mutation>) => void,
    retries?: number
  ): Promise<FunctionReturnType<Mutation>> {
    return this.#core.mutation(
      getFunctionName(mutation),
      args,
      dedupeKey,
      optimistic === undefined
        ? undefined
        : (context) =>
            FrameworkClient.#runOptimisticUpdate(args, optimistic, context),
      retries
    )
  }

  action<Action extends FunctionReference<'action'>>(
    action: Action,
    args: FunctionArgs<Action>,
    retries?: number,
    dedupeValue?: Value
  ): Promise<FunctionReturnType<Action>> {
    const path = getFunctionName(action)
    return this.#actions.run(path, dedupeValue, () =>
      withRetries(
        () =>
          this.#sync.action({
            args: encodeConvexValue(args) as FunctionArgs<Action>,
            path
          }) as Promise<FunctionReturnType<Action>>,
        retries
      )
    )
  }

  prefetch<Query extends FunctionReference<'query'>>(
    query: Query,
    args: FunctionArgs<Query>
  ): FrameworkPrefetchHandle<FunctionReturnType<Query>> {
    const handle = this.prepareQuery(query, args)
    let active = true
    let release: (() => void) | null = null
    let rejectReady: ((error: unknown) => void) | null = null
    const ready = new Promise<FunctionReturnType<Query>>((resolve, reject) => {
      rejectReady = reject
      release = handle.subscribe(() => {
        const snapshot = handle.getSnapshot()
        if (snapshot.status === 'pending') {
          return
        }
        active = false
        release?.()
        if (snapshot.status === 'success') {
          resolve(snapshot.data)
        } else {
          reject(snapshot.error)
        }
      })
    })

    return {
      cancel: () => {
        if (!active) {
          return
        }
        active = false
        release?.()
        rejectReady?.(new DOMException('Prefetch canceled', 'AbortError'))
      },
      ready
    }
  }

  async close(): Promise<void> {
    this.#actions.clear()
    this.#core.close()
    await this.#sync.close()
  }

  static #runOptimisticUpdate<Mutation extends FunctionReference<'mutation'>>(
    args: FunctionArgs<Mutation>,
    optimistic: (context: FrameworkOptimisticContext<Mutation>) => void,
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
    } as FrameworkOptimisticStore

    optimistic({
      data: args,
      optimisticId: context.optimisticId as FrameworkOptimisticId,
      store
    })
  }

  static #canConnect() {
    return typeof WebSocket !== 'undefined'
  }
}

export function getDisabledQuerySnapshot(): FrameworkQueryDisabledResult {
  return disabledQuerySnapshot
}

const disabledQuerySnapshot: FrameworkQueryDisabledResult = {
  data: undefined,
  error: null,
  isLoading: false,
  status: 'disabled'
}

export type FrameworkQueryHandle<Data> = Pick<
  CoreQueryHandle<Data>,
  'getCacheGeneration' | 'getSnapshot' | 'subscribe'
>

export type FrameworkQueryDisabledResult = Readonly<{
  data: undefined
  error: null
  isLoading: false
  status: 'disabled'
}>

export type FrameworkClientOptions = Readonly<{
  fetchToken?: FrameworkAuthTokenFetcher
  gcTime?: number
}>

export type FrameworkPrefetchHandle<Data> = Readonly<{
  cancel: () => void
  ready: Promise<Data>
}>

export type FrameworkAuthTokenFetcher = SyncAuthTokenFetcher

export type FrameworkAuthOptions = SyncAuthOptions

export type FrameworkOptimisticContext<
  Mutation extends FunctionReference<'mutation'>
> = Readonly<{
  data: Readonly<FunctionArgs<Mutation>>
  optimisticId: FrameworkOptimisticId
  store: FrameworkOptimisticStore
}>

export type FrameworkOptimisticId = GenericId<never>

export type FrameworkOptimisticStore = Readonly<{
  get: <Query extends FunctionReference<'query'>>(
    query: Query,
    ...args: OptionalRestArgs<Query>
  ) => FrameworkOptimisticQuery<FunctionReturnType<Query>>
  paginated: <Query extends PaginatedQueryReference>(
    query: Query,
    args: PaginatedQueryArgs<Query>
  ) => FrameworkOptimisticPaginatedQuery<PaginatedQueryItem<Query>>
}>

export type FrameworkOptimisticPaginatedQuery<Element> =
  OptimisticPaginatedOperations<Element>

export type FrameworkOptimisticQuery<QueryValue> =
  OptimisticQueryValue<QueryValue>
