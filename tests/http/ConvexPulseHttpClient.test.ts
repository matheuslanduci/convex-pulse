import {
  ConvexPulseHttpClient,
  createPreloadedQuery,
  preloadedQueryArgs,
  preloadedQueryResult
} from 'convex-pulse/http'
import {
  fetchAction,
  fetchMutation,
  fetchQuery,
  preloadQuery
} from 'convex-pulse/nextjs'
import type { FunctionReference } from 'convex/server'
import { makeFunctionReference } from 'convex/server'
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('calls queries, mutations, and actions through the HTTP public API', async () => {
  const fetchMock = vi.fn(() => Promise.resolve(successResponse('ok')))
  const client = new ConvexPulseHttpClient('https://example.convex.cloud', {
    fetch: fetchMock
  })

  await expect(
    client.query(getValue, { args: { key: 'query' } })
  ).resolves.toBe('ok')
  await expect(
    client.mutation(setValue, {
      args: { key: 'mutation', value: 'next' },
      skipQueue: true
    })
  ).resolves.toBe('ok')
  await expect(
    client.action(echoValue, { args: { value: 'action' } })
  ).resolves.toBe('ok')

  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    'https://example.convex.cloud/api/query',
    'https://example.convex.cloud/api/mutation',
    'https://example.convex.cloud/api/action'
  ])
  expect(requestBody(fetchMock, 0)).toMatchObject({
    args: [{ key: 'query' }],
    path: 'fixture:getValue'
  })
  expect(requestBody(fetchMock, 1)).toMatchObject({
    args: [{ key: 'mutation', value: 'next' }],
    path: 'fixture:setValue'
  })
})

it('preserves Convex values in a transport-safe preloaded query', () => {
  const args = { key: 'rich' }
  const value = {
    bigint: 42n,
    bytes: new Uint8Array([0, 127, 255]).buffer,
    infinity: Number.POSITIVE_INFINITY,
    negativeZero: -0
  }
  const preloaded = createPreloadedQuery(getRichValue, args, value)

  // eslint-disable-next-line unicorn/prefer-structured-clone -- This assertion specifically verifies JSON transport safety.
  expect(JSON.parse(JSON.stringify(preloaded))).toEqual(preloaded)
  expect(preloadedQueryArgs(preloaded)).toEqual(args)
  expect(preloadedQueryResult(preloaded)).toEqual(value)
})

it('preloads a query from the HTTP client', async () => {
  const client = new ConvexPulseHttpClient('https://example.convex.cloud', {
    fetch: () => Promise.resolve(successResponse('server value'))
  })

  const preloaded = await client.preloadQuery(getValue, {
    args: { key: 'preload' }
  })

  expect(preloaded._name).toBe('fixture:getValue')
  expect(preloadedQueryArgs(preloaded)).toEqual({ key: 'preload' })
  expect(preloadedQueryResult(preloaded)).toBe('server value')
})

it('uses no-store HTTP requests in the Next.js helpers', async () => {
  const fetchMock = vi.fn(() => Promise.resolve(successResponse('next value')))
  vi.stubGlobal('fetch', fetchMock)

  await expect(
    fetchQuery(getValue, {
      args: { key: 'next' },
      url: 'https://example.convex.cloud'
    })
  ).resolves.toBe('next value')
  const preloaded = await preloadQuery(getValue, {
    args: { key: 'preload' },
    url: 'https://example.convex.cloud'
  })

  expect(preloadedQueryResult(preloaded)).toBe('next value')
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' })
})

it('exposes the HTTP URL and forwards authentication changes', async () => {
  const fetchMock = vi.fn(() => Promise.resolve(successResponse('ok')))
  const client = new ConvexPulseHttpClient('https://example.convex.cloud', {
    fetch: fetchMock
  })

  expect(client.url).toBe('https://example.convex.cloud')
  client.setAuth('secret-token')
  await client.query(getValue, { args: { key: 'authenticated' } })
  client.clearAuth()
  await client.query(getValue, { args: { key: 'anonymous' } })

  expect(requestHeaders(fetchMock, 0).get('authorization')).toBe(
    'Bearer secret-token'
  )
  expect(requestHeaders(fetchMock, 1).get('authorization')).toBeNull()
})

it('forwards queued and explicitly unqueued HTTP mutations', async () => {
  const fetchMock = vi.fn(() => Promise.resolve(successResponse('ok')))
  const client = new ConvexPulseHttpClient('https://example.convex.cloud', {
    fetch: fetchMock
  })

  await client.mutation(setValue, {
    args: { key: 'queued', value: 'first' }
  })
  await client.mutation(setValue, {
    args: { key: 'unqueued', value: 'second' },
    skipQueue: true
  })

  expect(requestBody(fetchMock, 0)).toMatchObject({
    args: [{ key: 'queued', value: 'first' }]
  })
  expect(requestBody(fetchMock, 1)).toMatchObject({
    args: [{ key: 'unqueued', value: 'second' }]
  })
})

it('surfaces HTTP failures through every operation', async () => {
  const client = new ConvexPulseHttpClient('https://example.convex.cloud', {
    fetch: () => Promise.resolve(errorResponse('public failure'))
  })

  await expect(
    client.query(getValue, { args: { key: 'query' } })
  ).rejects.toThrow('public failure')
  await expect(
    client.mutation(setValue, { args: { key: 'mutation', value: 'next' } })
  ).rejects.toThrow('public failure')
  await expect(
    client.action(echoValue, { args: { value: 'action' } })
  ).rejects.toThrow('public failure')
  await expect(
    client.preloadQuery(getValue, { args: { key: 'preload' } })
  ).rejects.toThrow('public failure')
})

it('runs every Next.js helper and forwards auth and deployment options', async () => {
  const fetchMock = vi.fn(() => Promise.resolve(successResponse('next value')))
  vi.stubGlobal('fetch', fetchMock)
  const options = {
    skipConvexDeploymentUrlCheck: true,
    token: 'next-token',
    url: 'https://custom.example.com'
  } as const

  await expect(
    fetchMutation(setValue, {
      ...options,
      args: { key: 'mutation', value: 'next' }
    })
  ).resolves.toBe('next value')
  await expect(
    fetchAction(echoValue, { ...options, args: { value: 'action' } })
  ).resolves.toBe('next value')

  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    'https://custom.example.com/api/mutation',
    'https://custom.example.com/api/action'
  ])
  expect(requestHeaders(fetchMock, 0).get('authorization')).toBe(
    'Bearer next-token'
  )
})

it('uses the public Convex environment URL and rejects a missing URL', async () => {
  const fetchMock = vi.fn(() => Promise.resolve(successResponse('env value')))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', 'https://environment.convex.cloud')

  await expect(
    fetchQuery(getValue, { args: { key: 'environment' } })
  ).resolves.toBe('env value')
  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    'https://environment.convex.cloud/api/query'
  )

  vi.stubGlobal('process', {})
  expect(() => fetchQuery(getValue, { args: { key: 'missing' } })).toThrow(
    'NEXT_PUBLIC_CONVEX_URL is not set'
  )
})

function successResponse(value: unknown) {
  return Response.json({
    logLines: [],
    status: 'success',
    value
  })
}

function errorResponse(message: string) {
  return Response.json({
    errorMessage: message,
    logLines: [],
    status: 'error'
  })
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, call: number) {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit
  return JSON.parse(String(init.body)) as unknown
}

function requestHeaders(fetchMock: ReturnType<typeof vi.fn>, call: number) {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit
  return new Headers(init.headers)
}

const getValue = makeFunctionReference<'query', { key: string }, string>(
  'fixture:getValue'
)
const setValue = makeFunctionReference<
  'mutation',
  { key: string; value: string },
  string
>('fixture:setValue')
const echoValue = makeFunctionReference<'action', { value: string }, string>(
  'fixture:echoValue'
)
const getRichValue = makeFunctionReference<
  'query',
  { key: string },
  {
    bigint: bigint
    bytes: ArrayBuffer
    infinity: number
    negativeZero: number
  }
>('fixture:getRichValue')

type _PublicReference = FunctionReference<'query'>
