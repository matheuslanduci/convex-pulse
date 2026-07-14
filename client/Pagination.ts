import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  PaginationOptions,
  PaginationResult
} from 'convex/server'

let nextPaginationId = 0

/** Prepares an aggregate query handle for a framework's pagination mode. */
export function preparePaginatedQuery<Query extends PaginatedQueryReference>(
  preparePage: PreparePaginationPage,
  query: Query,
  args: PaginatedQueryArgs<Query>,
  initialNumItems: number
): PaginatedQueryHandle<PaginatedQueryItem<Query>> {
  if (typeof initialNumItems !== 'number' || initialNumItems < 0) {
    throw new RangeError(
      `initialNumItems must be a non-negative number. Received ${String(initialNumItems)}`
    )
  }

  return new PaginatedQuerySession(preparePage, query, args, initialNumItems)
}

export function getDisabledPaginationSnapshot(): UseQueryPaginationResult<unknown> {
  return disabledPaginationSnapshot as UseQueryPaginationResult<unknown>
}

class PaginatedQuerySession<Item> {
  readonly #args: Readonly<Record<string, unknown>>
  readonly #initialNumItems: number
  readonly #listeners = new Set<() => void>()
  readonly #loadMore: (numItems: number) => void
  readonly #ownedPages = new Set<Page<Item>>()
  readonly #pages: Page<Item>[] = []
  readonly #query: PaginatedQueryReference
  readonly #preparePage: PreparePaginationPage
  readonly #splits = new Map<Page<Item>, readonly [Page<Item>, Page<Item>]>()
  #cacheGeneration: number | null = null
  #continueCursor: string | null = null
  #id = (nextPaginationId += 1)
  #isLoadingMore = false
  #snapshot: InternalPaginatedQueryResult<Item>

  constructor(
    preparePage: PreparePaginationPage,
    query: PaginatedQueryReference,
    args: Readonly<Record<string, unknown>>,
    initialNumItems: number
  ) {
    this.#preparePage = preparePage
    this.#query = query
    this.#args = args
    this.#initialNumItems = initialNumItems
    this.#loadMore = this.#loadNextPage.bind(this)
    this.#snapshot = this.#firstPageSnapshot()
    this.#addPage(initialNumItems, null)
  }

  getSnapshot = () => {
    this.#restartAfterAuthScopeChange()
    return this.#snapshot
  }

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    if (this.#listeners.size === 1) {
      for (const page of this.#pages) {
        this.#subscribePage(page)
      }
      this.#recompute()
    }

    let active = true
    return () => {
      if (!active) {
        return
      }
      active = false
      this.#listeners.delete(listener)
      if (this.#listeners.size === 0) {
        for (const page of this.#ownedPages) {
          page.release?.()
          page.release = null
        }
      }
    }
  }

  #addPage(numItems: number, cursor: string | null, endCursor?: string) {
    const page = this.#createPage(numItems, cursor, endCursor)
    this.#pages.push(page)
  }

  #createPage(numItems: number, cursor: string | null, endCursor?: string) {
    const queryArgs = {
      ...this.#args,
      paginationOpts: {
        cursor,
        ...(endCursor === undefined ? {} : { endCursor }),
        id: this.#id,
        numItems
      }
    } as FunctionArgs<PaginatedQueryReference>
    const handle = this.#preparePage(this.#query, queryArgs)
    this.#cacheGeneration ??= handle.getCacheGeneration?.() ?? null
    const page: Page<Item> = {
      cursor,
      handle: handle as unknown as Page<Item>['handle'],
      numItems,
      release: null
    }
    this.#ownedPages.add(page)
    if (this.#listeners.size > 0) {
      this.#subscribePage(page)
    }
    return page
  }

  #subscribePage(page: Page<Item>) {
    page.release ??= page.handle.subscribe(() => this.#recompute())
  }

  #loadNextPage(numItems: number) {
    if (this.#snapshot.status !== 'success' || !this.#snapshot.canLoadMore) {
      return
    }
    if (typeof numItems !== 'number' || numItems < 0) {
      throw new RangeError(
        `numItems must be a non-negative number. Received ${String(numItems)}`
      )
    }

    const cursor = this.#continueCursor
    if (cursor === null) {
      return
    }
    this.#isLoadingMore = true
    this.#addPage(numItems, cursor)
    this.#setSnapshot({
      canLoadMore: false,
      data: this.#snapshot.data ?? [],
      error: null,
      isLoading: true,
      isLoadingMore: true,
      loadMore: this.#loadMore,
      status: 'success'
    })
  }

  #recompute() {
    if (this.#restartAfterAuthScopeChange()) {
      return
    }

    const data: Item[] = []
    let lastResult: PaginationResult<Item> | null = null

    for (const page of this.#pages) {
      const snapshot = page.handle.getSnapshot()
      if (snapshot.status === 'pending') {
        this.#setSnapshot(
          data.length === 0
            ? this.#firstPageSnapshot()
            : {
                canLoadMore: false,
                data,
                error: null,
                isLoading: true,
                isLoadingMore: this.#isLoadingMore,
                loadMore: this.#loadMore,
                status: 'success'
              }
        )
        return
      }
      if (snapshot.status === 'error') {
        if (snapshot.error.message.includes('InvalidCursor')) {
          this.#restart()
          return
        }
        this.#isLoadingMore = false
        this.#setSnapshot({
          canLoadMore: false,
          data: undefined,
          error: snapshot.error,
          isLoading: false,
          isLoadingMore: false,
          loadMore: this.#loadMore,
          status: 'error'
        })
        return
      }
      if (snapshot.status === 'disabled') {
        this.#setSnapshot(this.#firstPageSnapshot())
        return
      }

      lastResult = snapshot.data as PaginationResult<Item>
      const split = this.#splits.get(page)
      if (split !== undefined) {
        if (
          split.every((splitPage) => {
            const { status } = splitPage.handle.getSnapshot()
            return status === 'success' || status === 'error'
          })
        ) {
          this.#completeSplit(page, split)
          this.#recompute()
          return
        }
      } else if (
        lastResult.splitCursor !== undefined &&
        lastResult.splitCursor !== null &&
        (lastResult.pageStatus === 'SplitRecommended' ||
          lastResult.pageStatus === 'SplitRequired' ||
          lastResult.page.length > this.#initialNumItems * 2)
      ) {
        this.#startSplit(page, lastResult)
      }
      if (lastResult.pageStatus === 'SplitRequired') {
        this.#setSnapshot(
          data.length === 0
            ? this.#firstPageSnapshot()
            : {
                canLoadMore: false,
                data,
                error: null,
                isLoading: true,
                isLoadingMore: this.#isLoadingMore,
                loadMore: this.#loadMore,
                status: 'success'
              }
        )
        return
      }
      data.push(...lastResult.page)
    }

    if (lastResult === null) {
      this.#setSnapshot(this.#firstPageSnapshot())
      return
    }
    if (lastResult.isDone) {
      this.#continueCursor = null
      this.#isLoadingMore = false
      this.#setSnapshot({
        canLoadMore: false,
        data,
        error: null,
        isLoading: false,
        isLoadingMore: false,
        loadMore: this.#loadMore,
        status: 'success'
      })
      return
    }

    this.#continueCursor = lastResult.continueCursor
    this.#isLoadingMore = false
    this.#setSnapshot({
      canLoadMore: true,
      data,
      error: null,
      isLoading: false,
      isLoadingMore: false,
      loadMore: this.#loadMore,
      status: 'success'
    })
  }

  #firstPageSnapshot(): InternalPaginatedQueryResult<Item> {
    return {
      canLoadMore: false,
      data: undefined,
      error: null,
      isLoading: true,
      isLoadingMore: false,
      loadMore: this.#loadMore,
      status: 'pending'
    }
  }

  #startSplit(page: Page<Item>, result: PaginationResult<Item>) {
    const { splitCursor } = result
    if (splitCursor === undefined || splitCursor === null) {
      return
    }
    const first = this.#createPage(page.numItems, page.cursor, splitCursor)
    const second = this.#createPage(
      page.numItems,
      splitCursor,
      result.continueCursor
    )
    this.#splits.set(page, [first, second])
  }

  #completeSplit(page: Page<Item>, split: readonly [Page<Item>, Page<Item>]) {
    const index = this.#pages.indexOf(page)
    if (index === -1) {
      return
    }
    page.release?.()
    this.#ownedPages.delete(page)
    this.#splits.delete(page)
    this.#pages.splice(index, 1, ...split)
  }

  #restart() {
    for (const page of this.#ownedPages) {
      page.release?.()
    }
    this.#ownedPages.clear()
    this.#pages.length = 0
    this.#splits.clear()
    this.#continueCursor = null
    this.#isLoadingMore = false
    nextPaginationId += 1
    this.#id = nextPaginationId
    const snapshot = this.#firstPageSnapshot()
    this.#addPage(this.#initialNumItems, null)
    this.#setSnapshot(snapshot)
  }

  #restartAfterAuthScopeChange() {
    const generation = this.#pages[0]?.handle.getCacheGeneration?.()
    if (
      generation === undefined ||
      this.#cacheGeneration === null ||
      generation === this.#cacheGeneration
    ) {
      return false
    }

    this.#cacheGeneration = generation
    this.#restart()
    return true
  }

  #setSnapshot(snapshot: InternalPaginatedQueryResult<Item>) {
    if (PaginatedQuerySession.#snapshotsEqual(this.#snapshot, snapshot)) {
      return
    }
    this.#snapshot = snapshot
    for (const listener of this.#listeners) {
      listener()
    }
  }

  static #snapshotsEqual<Item>(
    left: InternalPaginatedQueryResult<Item>,
    right: InternalPaginatedQueryResult<Item>
  ) {
    if (
      left.status !== right.status ||
      left.canLoadMore !== right.canLoadMore ||
      left.error !== right.error ||
      left.isLoading !== right.isLoading ||
      left.isLoadingMore !== right.isLoadingMore ||
      left.loadMore !== right.loadMore
    ) {
      return false
    }
    if (left.data === right.data) {
      return true
    }
    if (left.data === undefined || right.data === undefined) {
      return false
    }
    return (
      left.data.length === right.data.length &&
      left.data.every((item, index) => item === right.data?.[index])
    )
  }
}

function noop() {
  // Disabled pagination cannot load another page.
}

const disabledPaginationSnapshot: UseQueryPaginationResult<never> = {
  canLoadMore: false,
  data: undefined,
  error: null,
  isLoading: false,
  isLoadingMore: false,
  loadMore: noop,
  status: 'disabled'
}

/** A public paginated Convex query reference. */
export type PaginatedQueryReference = FunctionReference<
  'query',
  'public',
  { paginationOpts: PaginationOptions },
  PaginationResult<unknown>
>

/** Query arguments with pagination options managed by the hook. */
export type PaginatedQueryArgs<Query extends PaginatedQueryReference> = Omit<
  FunctionArgs<Query>,
  'paginationOpts'
>

/** The item returned by a paginated query. */
export type PaginatedQueryItem<Query extends PaginatedQueryReference> =
  FunctionReturnType<Query>['page'][number]

/** The reactive state of useQuery's pagination mode. */
export type UseQueryPaginationResult<
  Item,
  ThrowOnError extends boolean = false
> =
  | Readonly<{
      canLoadMore: false
      data: undefined
      error: null
      isLoading: false
      isLoadingMore: false
      loadMore: (numItems: number) => void
      status: 'disabled'
    }>
  | Readonly<{
      canLoadMore: false
      data: undefined
      error: null
      isLoading: true
      isLoadingMore: false
      loadMore: (numItems: number) => void
      status: 'pending'
    }>
  | Readonly<{
      canLoadMore: boolean
      data: Item[]
      error: null
      isLoading: boolean
      isLoadingMore: boolean
      loadMore: (numItems: number) => void
      status: 'success'
    }>
  | (ThrowOnError extends true
      ? never
      : Readonly<{
          canLoadMore: false
          data: undefined
          error: Error
          isLoading: false
          isLoadingMore: false
          loadMore: (numItems: number) => void
          status: 'error'
        }>)

type InternalPaginatedQueryResult<Item> = UseQueryPaginationResult<Item>

export type PaginatedQueryHandle<Item> = Readonly<{
  getSnapshot: () => UseQueryPaginationResult<Item>
  subscribe: (listener: () => void) => () => void
}>

type Page<Item> = {
  cursor: string | null
  handle: PaginationPageHandle & {
    getSnapshot: () =>
      | Readonly<{ status: 'pending' }>
      | Readonly<{ status: 'error'; error: Error }>
      | Readonly<{ status: 'disabled' }>
      | Readonly<{ status: 'success'; data: PaginationResult<Item> }>
  }
  numItems: number
  release: (() => void) | null
}

type PreparePaginationPage = (
  query: PaginatedQueryReference,
  args: FunctionArgs<PaginatedQueryReference>
) => PaginationPageHandle

type PaginationPageHandle = Readonly<{
  getCacheGeneration?: () => number
  getSnapshot: () => PaginationPageSnapshot
  subscribe: (listener: () => void) => () => void
}>

type PaginationPageSnapshot =
  | Readonly<{ status: 'pending' }>
  | Readonly<{ status: 'error'; error: Error }>
  | Readonly<{ status: 'disabled' }>
  | Readonly<{ status: 'success'; data: PaginationResult<unknown> }>
