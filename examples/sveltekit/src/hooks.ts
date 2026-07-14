import { env } from '$env/dynamic/public'
import {
  decodeConvexLoad,
  decodeConvexLoadPaginated,
  encodeConvexLoad,
  encodeConvexLoadPaginated,
  initConvex
} from 'convex-pulse/sveltekit'

initConvex(requiredEnvironmentVariable(env.PUBLIC_CONVEX_URL))

export const transport = {
  ConvexLoadPaginatedResult: {
    decode: decodeConvexLoadPaginated,
    encode: encodeConvexLoadPaginated
  },
  ConvexLoadResult: {
    decode: decodeConvexLoad,
    encode: encodeConvexLoad
  }
}

function requiredEnvironmentVariable(value: string | undefined) {
  if (value === undefined) {
    throw new Error('PUBLIC_CONVEX_URL is not set')
  }
  return value
}
