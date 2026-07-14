import type { FunctionReference, FunctionReturnType } from 'convex/server'

import { preloadedQueryResult } from '#http/index.js'
import type { PreloadedQuery } from '#http/index.js'

export class ConvexLoadResult<Query extends FunctionReference<'query'>> {
  readonly __convexPulseLoad = true
  readonly data: FunctionReturnType<Query>
  readonly error = null
  readonly isLoading = false
  readonly isStale = false
  readonly status = 'success' as const
  readonly preloaded: PreloadedQuery<Query>

  constructor(preloaded: PreloadedQuery<Query>) {
    this.preloaded = preloaded
    this.data = preloadedQueryResult(preloaded)
  }
}
