import { createPreloadedQuery as preloadQueryValue } from 'convex-pulse/http'
import {
  ConvexPulseSvelteClient,
  closeConvex,
  createAction,
  createMutation,
  createPrefetchQuery,
  createPreloadedQuery,
  createQuery,
  getConvexClient,
  initConvex,
  onDataChange
} from 'convex-pulse/svelte'
import type { CreateQueryOptions, SvelteQueryResult } from 'convex-pulse/svelte'
import type { PaginationOptions, PaginationResult } from 'convex/server'
import { makeFunctionReference } from 'convex/server'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, expect, expectTypeOf, it, vi } from 'vitest'

import { FakeWebSocket } from '#testkit/FakeWebSocket.js'

beforeEach(() => {
  FakeWebSocket.instances.length = 0
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

it('reuses and explicitly closes the app-scoped Svelte client', async () => {
  const client = initConvex('https://example.convex.cloud')
  const sameClient = initConvex('https://example.convex.cloud')

  expect(sameClient).toBe(client)
  expect(getConvexClient()).toBe(client)
  expect(() => initConvex('https://other.convex.cloud')).toThrow(
    'already initialized'
  )

  await closeConvex()
  expect(() => getConvexClient()).toThrow('has not been initialized')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

it('keeps private framework internals out of the Svelte runtime exports', async () => {
  const publicApi = await import('convex-pulse/svelte')

  expect(Object.keys(publicApi).toSorted()).toEqual([
    'ConvexPulseSvelteClient',
    'closeConvex',
    'createAction',
    'createMutation',
    'createPrefetchQuery',
    'createPreloadedQuery',
    'createQuery',
    'getConvexClient',
    'initConvex',
    'onDataChange',
    'setConvexClientContext',
    'setupAuth',
    'setupConvex',
    'skipToken',
    'useAction',
    'useAuth',
    'useConvexClient',
    'useMutation',
    'usePaginatedQuery',
    'usePrefetchQuery',
    'useQuery'
  ])
})

it('skips a Svelte query without requiring arguments or preparing a handle', async () => {
  const { client, socket } = setup()
  let snapshot: SvelteQueryResult<string[]> | undefined
  const release = createQuery(client, tasksById, { args: 'skip' }).subscribe(
    (value) => {
      snapshot = value
    }
  )
  await socket.connected()

  expect(snapshot?.status).toBe('disabled')
  expect(client.devtools.getSnapshot().queries).toEqual([])
  expect(socket.querySetFrames()).toHaveLength(0)

  release()
  await client.close()
})

it('publishes preloaded Svelte data before the live query arrives', async () => {
  const { client, socket } = setup()
  const query = createPreloadedQuery(
    client,
    preloadQueryValue(tasks, {}, ['from server'])
  )
  const snapshots: SvelteQueryResult<string[]>[] = []
  const release = query.subscribe((snapshot) => snapshots.push(snapshot))

  expect(snapshots.at(-1)).toMatchObject({
    data: ['from server'],
    status: 'success'
  })
  await socket.succeed(['live value'])
  expect(snapshots.at(-1)).toMatchObject({
    data: ['live value'],
    status: 'success'
  })

  release()
  await client.close()
})

it('only includes disabled state for conditionally enabled Svelte queries', async () => {
  const { client } = setup()
  const enabled = writable(false)
  const conditionallyEnabledOptions: CreateQueryOptions<typeof tasks> = {
    args: {},
    enabled
  }
  const releaseEnabled = createQuery(
    client,
    tasks,
    conditionallyEnabledOptions
  ).subscribe((snapshot) => {
    if (snapshot.status === 'disabled') {
      expectTypeOf(snapshot.data).toEqualTypeOf<undefined>()
    }
  })
  const releaseAlwaysEnabled = createQuery(client, tasks, {
    args: {}
  }).subscribe((snapshot) => {
    if (snapshot.status !== 'pending' && snapshot.status !== 'error') {
      expectTypeOf(snapshot.data).toEqualTypeOf<string[]>()
    }
  })

  releaseEnabled()
  releaseAlwaysEnabled()
  await client.close()
})

it('exposes Svelte query state to devtools', async () => {
  const { client } = setup()
  const release = createQuery(client, tasks, { args: {} }).subscribe(noop)
  expect(client.devtools.getSnapshot().queries).toMatchObject([
    { status: 'pending' }
  ])
  release()
  await client.close()
})

it('reacts to live Svelte query results and releases on unsubscribe', async () => {
  const { client, socket } = setup()
  const query = createQuery(client, tasks, { args: {} })
  let snapshot: SvelteQueryResult<string[]> | undefined
  const release = query.subscribe((value) => {
    snapshot = value
  })
  expect(snapshot?.status).toBe('pending')

  await socket.succeed(['Buy milk'])
  expect(snapshot).toMatchObject({ data: ['Buy milk'], status: 'success' })

  await socket.succeed(['Buy milk', 'Walk dog'])
  expect(snapshot).toMatchObject({
    data: ['Buy milk', 'Walk dog'],
    status: 'success'
  })

  release()
  expect(socket.removeFrames()).toHaveLength(1)
  await client.close()
})

it('updates a Svelte store only when its selected value changes', async () => {
  const { client, socket } = setup()
  const optionListener = vi.fn()
  const standaloneListener = vi.fn()
  const query = createQuery(client, tasks, {
    args: {},
    onDataChange: optionListener,
    select: (values) => values.filter((value) => !value.startsWith('done:'))
  })
  const snapshots: SvelteQueryResult<string[]>[] = []
  const releaseDataChange = onDataChange(query, standaloneListener)
  const release = query.subscribe((snapshot) => snapshots.push(snapshot))

  await socket.succeed(['Buy milk'])
  const updateCount = snapshots.length
  expect(snapshots.at(-1)?.data).toEqual(['Buy milk'])
  expect(optionListener).not.toHaveBeenCalled()
  expect(standaloneListener).not.toHaveBeenCalled()

  await socket.succeed(['Buy milk', 'done: Walk dog'])
  expect(snapshots).toHaveLength(updateCount)
  expect(optionListener).not.toHaveBeenCalled()
  expect(standaloneListener).not.toHaveBeenCalled()

  await socket.succeed(['Buy milk', 'Walk dog'])
  expect(snapshots).toHaveLength(updateCount + 1)
  expect(snapshots.at(-1)?.data).toEqual(['Buy milk', 'Walk dog'])
  const change = {
    next: ['Buy milk', 'Walk dog'],
    previous: ['Buy milk']
  }
  expect(optionListener).toHaveBeenCalledWith(change)
  expect(standaloneListener).toHaveBeenCalledWith(change)

  releaseDataChange()
  release()
  await client.close()
})

it('loads paginated Svelte queries through createQuery', async () => {
  const { client, socket } = setup()
  const query = createQuery(client, paginatedTasks, {
    args: {},
    pagination: { initialNumItems: 1 }
  })
  let loadMore: (numItems: number) => void = noop
  let data: unknown
  const release = query.subscribe((snapshot) => {
    const { data: nextData, loadMore: nextLoadMore } = snapshot
    data = nextData
    loadMore = nextLoadMore
  })

  await socket.succeed(page(['one'], false, 'next'))
  loadMore(1)
  await socket.succeed(page(['two'], true, 'done'), 1)
  expect(data).toEqual(['one', 'two'])

  release()
  await client.close()
})

it('shares one Svelte query subscription between store subscribers', async () => {
  const { client, socket } = setup()
  const query = createQuery(client, tasks, { args: {} })
  const releaseFirst = query.subscribe(noop)
  const releaseSecond = query.subscribe(noop)
  await socket.connected()

  expect(socket.querySetFrames()).toHaveLength(1)
  releaseFirst()
  expect(socket.removeFrames()).toHaveLength(0)
  releaseSecond()
  expect(socket.removeFrames()).toHaveLength(1)
  await client.close()
})

it('subscribes only while a Svelte query is enabled', async () => {
  const { client, socket } = setup()
  const enabled = writable(false)
  const query = createQuery(client, tasks, { args: {}, enabled })
  let snapshot: SvelteQueryResult<string[]> | undefined
  const release = query.subscribe((value) => {
    snapshot = value
  })
  await socket.connected()

  expect(snapshot?.status).toBe('disabled')
  expect(socket.querySetFrames()).toHaveLength(0)

  enabled.set(true)
  await vi.waitFor(() => expect(socket.querySetFrames()).toHaveLength(1))
  expect(snapshot?.status).toBe('pending')

  await socket.succeed(['Buy milk'])
  expect(snapshot?.status).toBe('success')

  enabled.set(false)
  await vi.waitFor(() => expect(socket.removeFrames()).toHaveLength(1))
  expect(snapshot?.status).toBe('disabled')

  release()
  await client.close()
})

it('preserves and confirms an optimistic Svelte mutation without duplication', async () => {
  const { client, socket } = setup()
  const query = createQuery(client, tasks, { args: {} })
  let snapshot: SvelteQueryResult<string[]> | undefined
  const release = query.subscribe((value) => {
    snapshot = value
  })
  await socket.succeed(['Buy milk'])
  const add = createMutation(client, setTask, {
    optimistic: ({ data, store }) => store.get(tasks).append(data.value)
  })

  const mutation = add({ value: 'Call mom' })
  expect(snapshot?.data).toEqual(['Buy milk', 'Call mom'])

  await socket.resolveMutation('Call mom', ['Buy milk', 'Call mom'])
  await expect(mutation).resolves.toBe('Call mom')
  expect(snapshot?.data).toEqual(['Buy milk', 'Call mom'])

  release()
  await client.close()
})

it('rolls back a failed optimistic Svelte mutation onto the latest server value', async () => {
  const { client, socket } = setup()
  const query = createQuery(client, tasks, { args: {} })
  let snapshot: SvelteQueryResult<string[]> | undefined
  const release = query.subscribe((value) => {
    snapshot = value
  })
  await socket.succeed(['Buy milk'])
  const add = createMutation(client, setTask, {
    optimistic: ({ data, store }) => store.get(tasks).append(data.value)
  })

  const mutation = add({ value: 'Call mom' })
  await socket.succeed(['Buy milk', 'Pay rent'])
  expect(snapshot?.data).toEqual(['Buy milk', 'Pay rent', 'Call mom'])

  await socket.rejectMutation('Not allowed')
  await expect(mutation).rejects.toThrow('Not allowed')
  expect(snapshot?.data).toEqual(['Buy milk', 'Pay rent'])

  release()
  await client.close()
})

it('exposes query failures through the Svelte store', async () => {
  const { client, socket } = setup()
  const query = createQuery(client, tasks, { args: {} })
  let snapshot: SvelteQueryResult<string[]> | undefined
  const release = query.subscribe((value) => {
    snapshot = value
  })

  await socket.fail('Not allowed')
  expect(snapshot?.status).toBe('error')
  expect(snapshot?.error).toMatchObject({ message: 'Not allowed' })

  release()
  await client.close()
})

it('resolves and cancels Svelte prefetch handles', async () => {
  const { client, socket } = setup()
  const prefetch = createPrefetchQuery(client, tasks)
  const successful = prefetch()

  await socket.succeed(['Buy milk'])
  await expect(successful.ready).resolves.toEqual(['Buy milk'])

  const canceled = prefetch()
  canceled.cancel()
  await expect(canceled.ready).rejects.toMatchObject({ name: 'AbortError' })

  await client.close()
})

it('resets active Svelte queries on auth changes and closes the transport', async () => {
  const { client, socket } = setup()
  const query = createQuery(client, tasks, { args: {} })
  let snapshot: SvelteQueryResult<string[]> | undefined
  const release = query.subscribe((value) => {
    snapshot = value
  })
  await socket.succeed(['Buy milk'])

  client.setAuth(() => Promise.resolve('token'))
  await vi.waitFor(() => expect(socket.authenticateFrames()).toHaveLength(1))
  await socket.confirmAuth()
  expect(snapshot?.status).toBe('pending')

  release()
  await client.close()
  expect(socket.readyState).toBe(3)
})

it('fetches an auth token from the Svelte client options', async () => {
  const fetchToken = vi.fn(() => Promise.resolve('svelte-token'))
  const client = new ConvexPulseSvelteClient('https://example.convex.cloud', {
    fetchToken
  })
  const [socket] = FakeWebSocket.instances
  if (socket === undefined) {
    throw new Error('Expected the client to create a WebSocket')
  }

  await socket.connected()
  await vi.waitFor(() => expect(socket.authenticateFrames()).toHaveLength(1))

  expect(fetchToken).toHaveBeenCalledWith({ forceRefreshToken: false })
  expect(socket.authenticateFrames()[0]).toMatchObject({
    value: 'svelte-token'
  })
  await client.close()
})

it('forwards Svelte query and mutation retry options', async () => {
  const { client, socket } = setup()
  let snapshot: SvelteQueryResult<string[]> | undefined
  const release = createQuery(client, tasks, {
    args: {},
    retries: 1
  }).subscribe((value) => {
    snapshot = value
  })
  const mutation = createMutation(client, setTask, { retries: 1 })

  await socket.fail('first')
  expect(snapshot?.status).toBe('pending')
  await socket.succeed(['ready'], 1)
  expect(snapshot?.data).toEqual(['ready'])

  const result = mutation({ value: 'done' })
  await socket.rejectMutation('first')
  await vi.waitFor(() => expect(socket.mutationFrames()).toHaveLength(2))
  await socket.resolveMutation('done')
  await expect(result).resolves.toBe('done')

  release()
  await client.close()
})

it('exposes Svelte mutation state as a readable store', async () => {
  const { client, socket } = setup()
  const mutation = createMutation(client, setTask)
  const statuses: string[] = []
  const release = mutation.subscribe((snapshot) =>
    statuses.push(snapshot.status)
  )

  const result = mutation({ value: 'done' })
  expect(mutation.isPending).toBe(true)
  await socket.resolveMutation('saved')
  await expect(result).resolves.toBe('saved')
  expect(mutation.data).toBe('saved')
  expect(statuses).toEqual(['idle', 'pending', 'success'])

  mutation.reset()
  expect(statuses).toEqual(['idle', 'pending', 'success', 'idle'])
  release()
  await client.close()
})

it('exposes Svelte action state as a readable store with retries', async () => {
  const { client, socket } = setup()
  const action = createAction(client, formatTask, { retries: 1 })
  const statuses: string[] = []
  const release = action.subscribe((snapshot) => statuses.push(snapshot.status))

  const result = action({ value: 'docs' })
  expect(action.isPending).toBe(true)
  await socket.rejectAction('try again')
  await vi.waitFor(() => expect(socket.actionFrames()).toHaveLength(2))
  await socket.resolveAction('formatted')
  await expect(result).resolves.toBe('formatted')
  expect(action.data).toBe('formatted')
  expect(statuses).toEqual(['idle', 'pending', 'success'])

  action.reset()
  expect(statuses).toEqual(['idle', 'pending', 'success', 'idle'])
  release()
  await client.close()
})

function setup() {
  const client = new ConvexPulseSvelteClient('https://example.convex.cloud')
  const [socket] = FakeWebSocket.instances

  if (socket === undefined) {
    throw new Error('Expected the client to create a WebSocket')
  }

  return { client, socket }
}

function noop() {}

const tasks = makeFunctionReference<'query', Record<string, never>, string[]>(
  'tasks:list'
)
const tasksById = makeFunctionReference<'query', { id: string }, string[]>(
  'tasks:listById'
)
const setTask = makeFunctionReference<'mutation', { value: string }, string>(
  'tasks:set'
)
const formatTask = makeFunctionReference<'action', { value: string }, string>(
  'tasks:format'
)
const paginatedTasks = makeFunctionReference<
  'query',
  { paginationOpts: PaginationOptions },
  PaginationResult<string>
>('tasks:paginated')

function page(values: string[], isDone: boolean, continueCursor: string) {
  return { continueCursor, isDone, page: values }
}
