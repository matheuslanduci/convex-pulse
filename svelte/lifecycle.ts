/* oxlint-disable import/no-cycle -- the public Svelte entrypoint owns the client class */
import { getContext, setContext } from 'svelte'

import type { ConvexPulseSvelteClientOptions } from '#svelte/index.js'
import { ConvexPulseSvelteClient } from '#svelte/index.js'

const clientContextKey = Symbol.for('convex-pulse.svelte.client')
const authContextKey = Symbol.for('convex-pulse.svelte.auth')

let singleton: SvelteClientSingleton | null = null
let serverTokenGetter: () => string | undefined = getUndefinedToken

export function setupConvex(
  url: string,
  options: ConvexPulseSvelteClientOptions = {}
) {
  const client = initConvex(url, options)
  setConvexClientContext(client)
  return client
}

export function initConvex(
  url: string,
  options: ConvexPulseSvelteClientOptions = {}
) {
  if (typeof url !== 'string' || url.length === 0) {
    throw new TypeError('setupConvex requires a non-empty deployment URL')
  }
  if (singleton !== null) {
    if (singleton.url !== url) {
      throw new Error(
        `Convex Pulse is already initialized for ${singleton.url}. Call closeConvex() before switching deployments.`
      )
    }
    return singleton.client
  }

  const client = new ConvexPulseSvelteClient(url, options)
  singleton = { client, url }
  return client
}

export function setConvexClientContext(client: ConvexPulseSvelteClient) {
  return setContext(clientContextKey, client)
}

export function useConvexClient() {
  const client = getContext<ConvexPulseSvelteClient | undefined>(
    clientContextKey
  )
  if (client === undefined) {
    throw new Error(
      'No Convex Pulse client was found in Svelte context. Call setupConvex() in a parent component.'
    )
  }
  return client
}

export function getConvexClient() {
  if (singleton === null) {
    throw new Error(
      'Convex Pulse has not been initialized. Call setupConvex().'
    )
  }
  return singleton.client
}

export function getConvexUrl() {
  if (singleton === null) {
    throw new Error('Convex Pulse has not been initialized. Call initConvex().')
  }
  return singleton.url
}

export async function closeConvex() {
  const current = singleton
  singleton = null
  await current?.client.close()
}

export function setAuthContext(context: SvelteAuthContext) {
  return setContext(authContextKey, context)
}

export function getAuthContext() {
  return getContext<SvelteAuthContext | undefined>(authContextKey)
}

export function setServerTokenGetter(getter: () => string | undefined) {
  serverTokenGetter = getter
}

export function getServerToken() {
  return serverTokenGetter()
}

function getUndefinedToken() {
  return singleton?.serverToken
}

type SvelteClientSingleton = Readonly<{
  client: ConvexPulseSvelteClient
  serverToken?: string
  url: string
}>

export type SvelteAuthContext = Readonly<{
  readonly isAuthenticated: boolean
  readonly isLoading: boolean
  readonly isRefreshing: boolean
}>
