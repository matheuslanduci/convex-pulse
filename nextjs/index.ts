import type { FunctionReference, FunctionReturnType } from 'convex/server'

import { ConvexPulseHttpClient } from '#http/index.js'
import type {
  HttpActionOptions,
  HttpMutationCallOptions,
  HttpQueryOptions,
  PreloadedQuery
} from '#http/index.js'

/** Fetches a query from a Next.js Server Component, Function, or Route Handler. */
export function fetchQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  options: NextjsQueryOptions<Query>
): Promise<FunctionReturnType<Query>> {
  return createClient(options).query(query, options)
}

/** Executes a mutation from a Next.js Server Function or Route Handler. */
export function fetchMutation<Mutation extends FunctionReference<'mutation'>>(
  mutation: Mutation,
  options: NextjsMutationOptions<Mutation>
): Promise<FunctionReturnType<Mutation>> {
  return createClient(options).mutation(mutation, options)
}

/** Executes an action from a Next.js Server Function or Route Handler. */
export function fetchAction<Action extends FunctionReference<'action'>>(
  action: Action,
  options: NextjsActionOptions<Action>
): Promise<FunctionReturnType<Action>> {
  return createClient(options).action(action, options)
}

/** Fetches a query and returns a payload for React's usePreloadedQuery hook. */
export function preloadQuery<Query extends FunctionReference<'query'>>(
  query: Query,
  options: NextjsQueryOptions<Query>
): Promise<PreloadedQuery<Query>> {
  return createClient(options).preloadQuery(query, options)
}

function createClient(options: NextjsOptions) {
  const url = options.url ?? deploymentUrl()
  if (url === undefined) {
    throw new Error('NEXT_PUBLIC_CONVEX_URL is not set')
  }

  const client = new ConvexPulseHttpClient(url, {
    ...(options.skipConvexDeploymentUrlCheck === undefined
      ? {}
      : {
          skipConvexDeploymentUrlCheck: options.skipConvexDeploymentUrlCheck
        }),
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        cache: 'no-store'
      }),
    ...(options.token === undefined ? {} : { auth: options.token })
  })
  return client
}

function deploymentUrl() {
  const runtime = globalThis as RuntimeWithProcess
  return runtime.process?.env?.NEXT_PUBLIC_CONVEX_URL
}

export { preloadedQueryResult } from '#http/index.js'
export type { PreloadedQuery } from '#http/index.js'

export type NextjsOptions = Readonly<{
  skipConvexDeploymentUrlCheck?: boolean
  token?: string
  url?: string
}>

export type NextjsQueryOptions<Query extends FunctionReference<'query'>> =
  HttpQueryOptions<Query> & NextjsOptions

export type NextjsMutationOptions<
  Mutation extends FunctionReference<'mutation'>
> = HttpMutationCallOptions<Mutation> & NextjsOptions

export type NextjsActionOptions<Action extends FunctionReference<'action'>> =
  HttpActionOptions<Action> & NextjsOptions

type RuntimeWithProcess = typeof globalThis & {
  process?: { env?: { NEXT_PUBLIC_CONVEX_URL?: string } }
}
