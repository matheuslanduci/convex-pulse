import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType
} from 'convex/server'
import type { Value } from 'convex/values'

import type { DevtoolsHandle } from '#client/Devtools.js'
import { FrameworkClient } from '#client/FrameworkClient.js'
import type {
  FrameworkAuthOptions,
  FrameworkAuthTokenFetcher,
  FrameworkClientOptions
} from '#client/FrameworkClient.js'
import type { OptimisticMutationContext } from '#react/useMutation.js'
import type { UseQueryResult } from '#react/useQuery.js'

/**
 * A Convex Pulse client configured for React applications.
 *
 * @public
 */
export class ConvexPulseReactClient {
  readonly devtools: DevtoolsHandle
  readonly #client: FrameworkClient

  /** Creates a React client for a Convex deployment. */
  constructor(url: string, options: ConvexPulseReactClientOptions = {}) {
    this.#client = new FrameworkClient(url, options)
    this.devtools = this.#client.devtools
  }

  /** Uses a JWT token provider for subsequent operations. */
  setAuth(fetchToken: AuthTokenFetcher, options: AuthOptions = {}) {
    this.#client.setAuth(fetchToken, options)
  }

  /** Returns the client to the anonymous identity. */
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
  ): ReactQueryHandle<Selected> {
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
  ): ReactPrefetchHandle<FunctionReturnType<Query>> {
    return this.#client.prefetch(query, args)
  }

  /** Permanently closes the client and its active subscriptions. */
  async close(): Promise<void> {
    await this.#client.close()
  }
}

export type ReactQueryHandle<Data> = Readonly<{
  getSnapshot: () => UseQueryResult<Data>
  subscribe: (listener: () => void) => () => void
}>

export type ReactPrefetchHandle<Data> = Readonly<{
  cancel: () => void
  ready: Promise<Data>
}>

export type AuthTokenFetcher = FrameworkAuthTokenFetcher

export type AuthOptions = FrameworkAuthOptions

export type ConvexPulseReactClientOptions = FrameworkClientOptions
