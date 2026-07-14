import { skipToken } from 'convex-pulse/svelte'
import {
  closeConvex,
  createConvexHttpClient,
  ConvexLoadPaginatedResult,
  ConvexLoadResult,
  convexLoad,
  convexLoadPaginated,
  decodeConvexLoad,
  decodeConvexLoadPaginated,
  encodeConvexLoad,
  encodeConvexLoadPaginated,
  getConvexUrl,
  setupSvelteKitConvex
} from 'convex-pulse/sveltekit'
import { withServerConvexToken } from 'convex-pulse/sveltekit/server'
import { makeFunctionReference } from 'convex/server'
import { afterEach, expect, it, vi } from 'vitest'

import { createPreloadedQuery } from '#http/index.js'
import { getServerToken } from '#svelte/lifecycle.js'

afterEach(async () => {
  vi.unstubAllGlobals()
  await closeConvex()
})

it('returns disabled SSR states for the real skip token without a client', async () => {
  const query = makeFunctionReference<'query'>('fixture:getValue')
  const paginatedQuery = makeFunctionReference<'query'>(
    'fixture:paginateLabels'
  )

  await expect(convexLoad(query, skipToken)).resolves.toMatchObject({
    data: undefined,
    isLoading: false,
    status: 'disabled'
  })
  await expect(
    convexLoadPaginated(paginatedQuery, skipToken, { initialNumItems: 2 })
  ).resolves.toMatchObject({
    canLoadMore: false,
    data: undefined,
    isLoading: false,
    status: 'disabled'
  })
})

it('encodes regular and paginated SSR result markers', () => {
  const query = makeFunctionReference<'query'>('fixture:getValue')
  const preloaded = createPreloadedQuery(query, { key: 'a' }, 'value')
  const result = new ConvexLoadResult(preloaded)
  expect(encodeConvexLoad(result)).toEqual(preloaded)
  expect(encodeConvexLoad({})).toBe(false)

  const paginatedQuery = makeFunctionReference<'query'>(
    'fixture:paginateLabels'
  )
  const paginated = createPreloadedQuery(
    paginatedQuery,
    { paginationOpts: { cursor: null, numItems: 2 }, prefix: 'item' },
    { continueCursor: '2', isDone: false, page: ['item-1', 'item-2'] }
  )
  const paginatedResult = new ConvexLoadPaginatedResult(paginated, 2)
  expect(encodeConvexLoadPaginated(paginatedResult)).toEqual({
    initialNumItems: 2,
    preloaded: paginated
  })
  expect(encodeConvexLoadPaginated({})).toBe(false)
})

it('isolates server auth tokens across overlapping requests', async () => {
  const releaseFirst = Promise.withResolvers<'continue'>()
  const first = withServerConvexToken('first-token', async () => {
    expect(getServerToken()).toBe('first-token')
    await releaseFirst.promise
    expect(getServerToken()).toBe('first-token')
  })
  const second = withServerConvexToken('second-token', async () => {
    expect(getServerToken()).toBe('second-token')
    await Promise.resolve()
    expect(getServerToken()).toBe('second-token')
  })

  await second
  releaseFirst.resolve('continue')
  await first
  expect(getServerToken()).toBeUndefined()
})

it('initializes SvelteKit and creates authenticated HTTP clients', async () => {
  const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(successResponse('value'))
  )
  setupSvelteKitConvex('https://example.convex.cloud')

  expect(getConvexUrl()).toBe('https://example.convex.cloud')
  const client = withServerConvexToken('server-token', () =>
    createConvexHttpClient({ options: { fetch: fetchMock } })
  )
  await expect(
    client.query(makeFunctionReference<'query'>('fixture:getValue'), {
      args: { key: 'server' }
    })
  ).resolves.toBe('value')

  const init = fetchMock.mock.calls[0]?.[1] as RequestInit
  expect(new Headers(init.headers).get('authorization')).toBe(
    'Bearer server-token'
  )
})

it('loads and decodes regular SvelteKit server queries', async () => {
  vi.stubGlobal('$state', identity)
  vi.stubGlobal('fetch', () => Promise.resolve(successResponse('server value')))
  setupSvelteKitConvex('https://example.convex.cloud')
  const query = makeFunctionReference<'query'>('fixture:getValue')

  const loaded = await convexLoad(query, { key: 'server' })
  expect(loaded).toBeInstanceOf(ConvexLoadResult)
  expect(loaded).toMatchObject({ data: 'server value', status: 'success' })

  const encoded = encodeConvexLoad(loaded)
  if (encoded === false) {
    throw new Error('Expected the loaded query to be encodable')
  }
  const decoded = decodeConvexLoad(encoded)
  expect(decoded).toMatchObject({ data: 'server value', status: 'success' })
})

it('loads and decodes paginated SvelteKit server queries', async () => {
  vi.stubGlobal('$state', identity)
  const page = {
    continueCursor: '2',
    isDone: false,
    page: ['label-1', 'label-2']
  }
  vi.stubGlobal('fetch', () => Promise.resolve(successResponse(page)))
  setupSvelteKitConvex('https://example.convex.cloud')
  const query = makeFunctionReference<'query'>('fixture:paginateLabels')

  const loaded = await convexLoadPaginated(
    query,
    { prefix: 'label' },
    { initialNumItems: 2 }
  )
  expect(loaded).toBeInstanceOf(ConvexLoadPaginatedResult)
  expect(loaded).toMatchObject({
    canLoadMore: true,
    data: ['label-1', 'label-2'],
    status: 'success'
  })

  const encoded = encodeConvexLoadPaginated(loaded)
  if (encoded === false) {
    throw new Error('Expected the loaded pagination to be encodable')
  }
  const decoded = decodeConvexLoadPaginated(encoded)
  expect(decoded).toMatchObject({
    canLoadMore: true,
    data: ['label-1', 'label-2'],
    status: 'success'
  })
})

function successResponse(value: unknown) {
  return Response.json({ logLines: [], status: 'success', value })
}

function identity<Value>(value: Value) {
  return value
}
