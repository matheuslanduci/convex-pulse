import { initConvex } from '#svelte/lifecycle.js'

export { closeConvex, getConvexUrl, initConvex } from '#svelte/lifecycle.js'
export {
  ConvexLoadPaginatedResult,
  ConvexLoadResult,
  convexLoad,
  convexLoadPaginated,
  decodeConvexLoad,
  decodeConvexLoadPaginated,
  encodeConvexLoad,
  encodeConvexLoadPaginated
} from '#sveltekit/transport.svelte.js'
export type {
  ConvexLoadOptions,
  ConvexLoadPaginatedOptions,
  ConvexLoadPaginatedState,
  ConvexLoadState
} from '#sveltekit/transport.svelte.js'
export { createConvexHttpClient } from '#sveltekit/http.js'
export type { CreateConvexHttpClientOptions } from '#sveltekit/http.js'

export function setupSvelteKitConvex(
  url: string,
  options?: Parameters<typeof initConvex>[1]
) {
  return initConvex(url, options)
}
