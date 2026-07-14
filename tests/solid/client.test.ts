import {
  ConvexPulseSolidClient,
  createAction,
  createMutation,
  createOnDataChange,
  createPrefetchQuery,
  createQuery
} from 'convex-pulse/solid'
import type { PaginationOptions, PaginationResult } from 'convex/server'
import { makeFunctionReference } from 'convex/server'
import { createRoot, createSignal } from 'solid-js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { FakeWebSocket } from '#testkit/FakeWebSocket.js'

beforeEach(() => {
  FakeWebSocket.instances.length = 0
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

it('keeps private framework internals out of the Solid runtime exports', async () => {
  const publicApi = await import('convex-pulse/solid')

  expect(Object.keys(publicApi).toSorted()).toEqual([
    'ConvexPulseSolidClient',
    'createAction',
    'createMutation',
    'createOnDataChange',
    'createPrefetchQuery',
    'createQuery',
    'skipToken'
  ])
})

it('skips a Solid query without requiring arguments or preparing a handle', async () => {
  const { client, socket } = setup()
  let dispose = noop
  const query = createRoot((rootDispose) => {
    dispose = rootDispose
    return createQuery(client, tasksById, { args: 'skip' })
  })
  await socket.connected()

  expect(query().status).toBe('disabled')
  expect(client.devtools.getSnapshot().queries).toEqual([])
  expect(socket.querySetFrames()).toHaveLength(0)

  dispose()
  await client.close()
})

it('switches Solid query arguments reactively and cleans up each subscription', async () => {
  const { client, socket } = setup()
  let dispose = noop
  let setArgs!: (args: { id: string } | 'skip') => void
  const query = createRoot((rootDispose) => {
    dispose = rootDispose
    const [args, updateArgs] = createSignal<{ id: string } | 'skip'>('skip')
    setArgs = updateArgs
    return createQuery(client, tasksById, { args })
  })
  await socket.connected()
  expect(query().status).toBe('disabled')

  setArgs({ id: 'one' })
  expect(query().status).toBe('pending')
  await vi.waitFor(() => expect(socket.querySetFrames()).toHaveLength(1))
  await socket.succeed(['one'])
  expect(query().data).toEqual(['one'])

  setArgs({ id: 'two' })
  expect(query().status).toBe('pending')
  await vi.waitFor(() => {
    expect(socket.querySetFrames()).toHaveLength(3)
    expect(socket.removeFrames()).toHaveLength(1)
  })
  await socket.succeed(['two'], 1)
  expect(query().data).toEqual(['two'])

  setArgs('skip')
  expect(query().status).toBe('disabled')
  await vi.waitFor(() => expect(socket.removeFrames()).toHaveLength(2))

  dispose()
  await client.close()
})

it('exposes Solid query state to devtools', async () => {
  const { client } = setup()
  let dispose = noop
  createRoot((rootDispose) => {
    dispose = rootDispose
    createQuery(client, tasks, { args: {} })
  })
  expect(client.devtools.getSnapshot().queries).toMatchObject([
    { status: 'pending' }
  ])
  dispose()
  await client.close()
})

it('reacts to live query results and releases on owner cleanup', async () => {
  const { client, socket } = setup()
  let dispose = noop
  let query!: ReturnType<typeof createQuery<typeof tasks>>

  createRoot((rootDispose) => {
    dispose = rootDispose
    query = createQuery(client, tasks, { args: {} })
  })
  expect(query().status).toBe('pending')

  await socket.succeed(['Buy milk'])
  expect(query()).toMatchObject({ data: ['Buy milk'], status: 'success' })

  await socket.succeed(['Buy milk', 'Walk dog'])
  expect(query()).toMatchObject({
    data: ['Buy milk', 'Walk dog'],
    status: 'success'
  })

  dispose()
  expect(socket.removeFrames()).toHaveLength(1)
  await client.close()
})

it('updates a Solid query only when its selected value changes', async () => {
  const { client, socket } = setup()
  const optionListener = vi.fn()
  const standaloneListener = vi.fn()
  let dispose = noop
  const query = createRoot((rootDispose) => {
    dispose = rootDispose
    const result = createQuery(client, tasks, {
      args: {},
      onDataChange: optionListener,
      select: (values) => values.filter((value) => !value.startsWith('done:'))
    })
    createOnDataChange(result, standaloneListener)
    return result
  })

  await socket.succeed(['Buy milk'])
  const selected = query()
  expect(selected.data).toEqual(['Buy milk'])
  expect(optionListener).not.toHaveBeenCalled()
  expect(standaloneListener).not.toHaveBeenCalled()

  await socket.succeed(['Buy milk', 'done: Walk dog'])
  expect(query()).toBe(selected)
  expect(optionListener).not.toHaveBeenCalled()
  expect(standaloneListener).not.toHaveBeenCalled()

  await socket.succeed(['Buy milk', 'Walk dog'])
  expect(query()).not.toBe(selected)
  expect(query().data).toEqual(['Buy milk', 'Walk dog'])
  const change = {
    next: ['Buy milk', 'Walk dog'],
    previous: ['Buy milk']
  }
  expect(optionListener).toHaveBeenCalledWith(change)
  expect(standaloneListener).toHaveBeenCalledWith(change)

  dispose()
  await client.close()
})

it('loads paginated Solid queries through createQuery', async () => {
  const { client, socket } = setup()
  let dispose = noop
  const query = createRoot((rootDispose) => {
    dispose = rootDispose
    return createQuery(client, paginatedTasks, {
      args: {},
      pagination: { initialNumItems: 1 }
    })
  })

  await socket.succeed(page(['one'], false, 'next'))
  expect(query().data).toEqual(['one'])
  query().loadMore(1)
  await socket.succeed(page(['two'], true, 'done'), 1)
  expect(query()).toMatchObject({ canLoadMore: false, data: ['one', 'two'] })

  dispose()
  await client.close()
})

it('subscribes only while a Solid query is enabled', async () => {
  const { client, socket } = setup()
  let dispose = noop
  let query!: ReturnType<typeof createQuery<typeof tasks>>
  let setEnabled!: (enabled: boolean) => void

  createRoot((rootDispose) => {
    dispose = rootDispose
    const [enabled, updateEnabled] = createSignal(false)
    setEnabled = updateEnabled
    query = createQuery(client, tasks, { args: {}, enabled })
  })
  await socket.connected()

  expect(query().status).toBe('disabled')
  expect(socket.querySetFrames()).toHaveLength(0)

  setEnabled(true)
  expect(query().status).toBe('pending')
  await vi.waitFor(() => expect(socket.querySetFrames()).toHaveLength(1))

  await socket.succeed(['Buy milk'])
  expect(query().status).toBe('success')

  setEnabled(false)
  expect(query().status).toBe('disabled')
  await vi.waitFor(() => expect(socket.removeFrames()).toHaveLength(1))

  dispose()
  await client.close()
})

it('preserves and confirms an optimistic Solid mutation without duplication', async () => {
  const { client, socket } = setup()
  let dispose = noop
  let query!: ReturnType<typeof createQuery<typeof tasks>>

  createRoot((rootDispose) => {
    dispose = rootDispose
    query = createQuery(client, tasks, { args: {} })
  })
  await socket.succeed(['Buy milk'])
  const add = createMutation(client, setTask, {
    optimistic: ({ data, store }) => store.get(tasks).append(data.value)
  })

  const mutation = add({ value: 'Call mom' })
  expect(query().data).toEqual(['Buy milk', 'Call mom'])

  await socket.resolveMutation('Call mom', ['Buy milk', 'Call mom'])
  await expect(mutation).resolves.toBe('Call mom')
  expect(query().data).toEqual(['Buy milk', 'Call mom'])

  dispose()
  await client.close()
})

it('rolls back a failed optimistic Solid mutation onto the latest server value', async () => {
  const { client, socket } = setup()
  let dispose = noop
  let query!: ReturnType<typeof createQuery<typeof tasks>>

  createRoot((rootDispose) => {
    dispose = rootDispose
    query = createQuery(client, tasks, { args: {} })
  })
  await socket.succeed(['Buy milk'])
  const add = createMutation(client, setTask, {
    optimistic: ({ data, store }) => store.get(tasks).append(data.value)
  })

  const mutation = add({ value: 'Call mom' })
  await socket.succeed(['Buy milk', 'Pay rent'])
  expect(query().data).toEqual(['Buy milk', 'Pay rent', 'Call mom'])

  await socket.rejectMutation('Not allowed')
  await expect(mutation).rejects.toThrow('Not allowed')
  expect(query().data).toEqual(['Buy milk', 'Pay rent'])

  dispose()
  await client.close()
})

it('exposes query failures through the Solid accessor', async () => {
  const { client, socket } = setup()
  let dispose = noop
  let query!: ReturnType<typeof createQuery<typeof tasks>>

  createRoot((rootDispose) => {
    dispose = rootDispose
    query = createQuery(client, tasks, { args: {} })
  })

  await socket.fail('Not allowed')
  expect(query().status).toBe('error')
  expect(query().error).toMatchObject({ message: 'Not allowed' })

  dispose()
  await client.close()
})

it('throws Solid query failures from the accessor when requested', async () => {
  const { client, socket } = setup()
  let dispose = noop
  const query = createRoot((rootDispose) => {
    dispose = rootDispose
    return createQuery(client, tasks, { args: {}, throwOnError: true })
  })

  await socket.fail('Not allowed')
  expect(() => query()).toThrow('Not allowed')

  dispose()
  await client.close()
})

it('resolves and cancels Solid prefetch handles', async () => {
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

it('resets active Solid queries on auth changes and closes the transport', async () => {
  const { client, socket } = setup()
  let dispose = noop
  let query!: ReturnType<typeof createQuery<typeof tasks>>

  createRoot((rootDispose) => {
    dispose = rootDispose
    query = createQuery(client, tasks, { args: {} })
  })
  await socket.succeed(['Buy milk'])

  client.setAuth(() => Promise.resolve('token'))
  await vi.waitFor(() => expect(socket.authenticateFrames()).toHaveLength(1))
  await socket.confirmAuth()
  expect(query().status).toBe('pending')

  dispose()
  await client.close()
  expect(socket.readyState).toBe(3)
})

it('fetches an auth token from the Solid client options', async () => {
  const fetchToken = vi.fn(() => Promise.resolve('solid-token'))
  const client = new ConvexPulseSolidClient('https://example.convex.cloud', {
    fetchToken
  })
  const [socket] = FakeWebSocket.instances
  if (socket === undefined) {
    throw new Error('Expected the client to create a WebSocket')
  }

  await socket.connected()
  await vi.waitFor(() => expect(socket.authenticateFrames()).toHaveLength(1))

  expect(fetchToken).toHaveBeenCalledWith({ forceRefreshToken: false })
  expect(socket.authenticateFrames()[0]).toMatchObject({ value: 'solid-token' })
  await client.close()
})

it('forwards Solid query and mutation retry options', async () => {
  const { client, socket } = setup()
  let dispose = noop
  const query = createRoot((rootDispose) => {
    dispose = rootDispose
    return createQuery(client, tasks, { args: {}, retries: 1 })
  })
  const mutation = createMutation(client, setTask, { retries: 1 })

  await socket.fail('first')
  expect(query().status).toBe('pending')
  await socket.succeed(['ready'], 1)
  expect(query().data).toEqual(['ready'])

  const result = mutation({ value: 'done' })
  await socket.rejectMutation('first')
  await vi.waitFor(() => expect(socket.mutationFrames()).toHaveLength(2))
  await socket.resolveMutation('done')
  await expect(result).resolves.toBe('done')

  dispose()
  await client.close()
})

it('exposes Solid mutation state and lifecycle callbacks', async () => {
  const { client, socket } = setup()
  const onSuccess = vi.fn()
  let dispose = noop
  let mutation!: ReturnType<typeof createMutation<typeof setTask>>
  createRoot((rootDispose) => {
    dispose = rootDispose
    mutation = createMutation(client, setTask, { onSuccess })
  })

  const result = mutation({ value: 'done' })
  expect(mutation.status).toBe('pending')
  expect(mutation.isPending).toBe(true)
  await socket.resolveMutation('saved')
  await expect(result).resolves.toBe('saved')
  expect(mutation.data).toBe('saved')
  expect(mutation.status).toBe('success')
  expect(onSuccess).toHaveBeenCalledWith({
    args: { value: 'done' },
    data: 'saved'
  })

  mutation.reset()
  expect(mutation.status).toBe('idle')
  dispose()
  await client.close()
})

it('exposes Solid action state, callbacks, retries, and reset', async () => {
  const { client, socket } = setup()
  const onSuccess = vi.fn()
  let dispose = noop
  let action!: ReturnType<typeof createAction<typeof formatTask>>
  createRoot((rootDispose) => {
    dispose = rootDispose
    action = createAction(client, formatTask, { onSuccess, retries: 1 })
  })

  const result = action({ value: 'docs' })
  expect(action.status).toBe('pending')
  expect(action.isPending).toBe(true)
  await socket.rejectAction('try again')
  await vi.waitFor(() => expect(socket.actionFrames()).toHaveLength(2))
  await socket.resolveAction('formatted')
  await expect(result).resolves.toBe('formatted')
  expect(action.status).toBe('success')
  expect(action.data).toBe('formatted')
  expect(onSuccess).toHaveBeenCalledWith({
    args: { value: 'docs' },
    data: 'formatted'
  })

  action.reset()
  expect(action.status).toBe('idle')
  dispose()
  await client.close()
})

function setup() {
  const client = new ConvexPulseSolidClient('https://example.convex.cloud')
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
const paginatedTasks = makeFunctionReference<
  'query',
  { paginationOpts: PaginationOptions },
  PaginationResult<string>
>('tasks:paginated')

function page(values: string[], isDone: boolean, continueCursor: string) {
  return { continueCursor, isDone, page: values }
}
const setTask = makeFunctionReference<'mutation', { value: string }, string>(
  'tasks:set'
)
const formatTask = makeFunctionReference<'action', { value: string }, string>(
  'tasks:format'
)
