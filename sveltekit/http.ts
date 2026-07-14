import type { ConvexPulseHttpClientOptions } from '#http/index.js'
import { ConvexPulseHttpClient } from '#http/index.js'
import { getConvexUrl, getServerToken } from '#svelte/lifecycle.js'

export function createConvexHttpClient(
  options: CreateConvexHttpClientOptions = {}
) {
  const client = new ConvexPulseHttpClient(
    options.url ?? getConvexUrl(),
    options.options
  )
  const token = options.token ?? getServerToken()
  if (token !== undefined) {
    client.setAuth(token)
  }
  return client
}

export type CreateConvexHttpClientOptions = Readonly<{
  options?: ConvexPulseHttpClientOptions
  token?: string
  url?: string
}>
