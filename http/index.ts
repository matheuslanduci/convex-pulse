import { ConvexHttpClient } from 'convex/browser'
import type { HttpMutationOptions } from 'convex/browser'
import type {
  ArgsAndOptions,
  FunctionArgs,
  FunctionReference,
  FunctionReturnType
} from 'convex/server'
import { getFunctionName } from 'convex/server'
import { convexToJson, jsonToConvex } from 'convex/values'

/** A non-reactive Convex client for server rendering, scripts, and serverless functions. */
export class ConvexPulseHttpClient {
  readonly #client: ConvexHttpClient

  constructor(url: string, options: ConvexPulseHttpClientOptions = {}) {
    this.#client = new ConvexHttpClient(url, options)
  }

  get url() {
    return this.#client.url
  }

  setAuth(token: string) {
    this.#client.setAuth(token)
  }

  clearAuth() {
    this.#client.clearAuth()
  }

  query<Query extends FunctionReference<'query'>>(
    query: Query,
    options: HttpQueryOptions<Query>
  ): Promise<FunctionReturnType<Query>> {
    return this.#client.query(query, options.args)
  }

  mutation<Mutation extends FunctionReference<'mutation'>>(
    mutation: Mutation,
    options: HttpMutationCallOptions<Mutation>
  ): Promise<FunctionReturnType<Mutation>> {
    if (options.skipQueue === undefined) {
      return this.#client.mutation(mutation, options.args)
    }
    const mutationOptions: HttpMutationOptions = {
      skipQueue: options.skipQueue
    }
    return this.#client.mutation(
      mutation,
      ...([options.args, mutationOptions] as ArgsAndOptions<
        Mutation,
        HttpMutationOptions
      >)
    )
  }

  action<Action extends FunctionReference<'action'>>(
    action: Action,
    options: HttpActionOptions<Action>
  ): Promise<FunctionReturnType<Action>> {
    return this.#client.action(action, options.args)
  }

  async preloadQuery<Query extends FunctionReference<'query'>>(
    query: Query,
    options: HttpQueryOptions<Query>
  ): Promise<PreloadedQuery<Query>> {
    const value = await this.query(query, options)

    return createPreloadedQuery(query, options.args, value)
  }
}

/** Creates a serializable query payload from an already available result. */
export function createPreloadedQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  args: FunctionArgs<Query>,
  value: FunctionReturnType<Query>
): PreloadedQuery<Query> {
  return {
    _argsJSON: JSON.stringify(convexToJson(args)),
    _name: getFunctionName(query),
    _valueJSON: JSON.stringify(convexToJson(value))
  } as PreloadedQuery<Query>
}

/** Reads the server result embedded in a preloaded query payload. */
export function preloadedQueryResult<Query extends FunctionReference<'query'>>(
  preloaded: PreloadedQuery<Query>
): FunctionReturnType<Query> {
  return jsonToConvex(
    JSON.parse(preloaded._valueJSON) as Parameters<typeof jsonToConvex>[0]
  ) as FunctionReturnType<Query>
}

/** Reads the arguments embedded in a preloaded query payload. */
export function preloadedQueryArgs<Query extends FunctionReference<'query'>>(
  preloaded: PreloadedQuery<Query>
): FunctionArgs<Query> {
  return jsonToConvex(
    JSON.parse(preloaded._argsJSON) as Parameters<typeof jsonToConvex>[0]
  ) as FunctionArgs<Query>
}

export type ConvexPulseHttpClientOptions = ConstructorParameters<
  typeof ConvexHttpClient
>[1]

export type HttpQueryOptions<Query extends FunctionReference<'query'>> =
  Readonly<{
    args: FunctionArgs<Query>
  }>

export type HttpMutationCallOptions<
  Mutation extends FunctionReference<'mutation'>
> = Readonly<{
  args: FunctionArgs<Mutation>
  skipQueue?: HttpMutationOptions['skipQueue']
}>

export type HttpActionOptions<Action extends FunctionReference<'action'>> =
  Readonly<{
    args: FunctionArgs<Action>
  }>

/** A transport-safe query result that can hydrate a live framework query. */
export type PreloadedQuery<Query extends FunctionReference<'query'>> =
  Readonly<{
    __type?: Query
    _argsJSON: string
    _name: string
    _valueJSON: string
  }>
