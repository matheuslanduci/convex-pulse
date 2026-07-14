import type {
  PaginatedQueryItem,
  PaginatedQueryReference
} from '#client/Pagination.js'
import { preloadedQueryResult } from '#http/index.js'
import type { PreloadedQuery } from '#http/index.js'

export class ConvexLoadPaginatedResult<Query extends PaginatedQueryReference> {
  readonly __convexPulsePaginatedLoad = true
  readonly data: PaginatedQueryItem<Query>[]
  readonly error = null
  readonly initialNumItems: number
  readonly isLoading = false
  readonly isLoadingMore = false
  readonly isStale = false
  readonly preloaded: PreloadedQuery<Query>
  readonly status = 'success' as const
  readonly canLoadMore: boolean
  readonly loadMore = () => this.canLoadMore && false

  constructor(preloaded: PreloadedQuery<Query>, initialNumItems: number) {
    const result = preloadedQueryResult(preloaded)
    this.preloaded = preloaded
    this.initialNumItems = initialNumItems
    this.data = result.page
    this.canLoadMore = !result.isDone
  }
}
