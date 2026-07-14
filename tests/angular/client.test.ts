import {
  Injector,
  computed,
  runInInjectionContext,
  signal
} from '@angular/core'
import {
  CONVEX_PULSE_CLIENT,
  ConvexPulseAngularClient,
  injectAction,
  injectMutation,
  injectOnDataChange,
  injectPrefetchQuery,
  injectQuery
} from 'convex-pulse/angular'
import { makeFunctionReference } from 'convex/server'
import type { PaginationOptions, PaginationResult } from 'convex/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { FakeWebSocket } from '#testkit/FakeWebSocket.js'

beforeEach(() => {
  FakeWebSocket.instances.length = 0
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

it('keeps private framework internals out of the Angular runtime exports', async () => {
  const publicApi = await import('convex-pulse/angular')

  expect(Object.keys(publicApi).toSorted()).toEqual([
    'CONVEX_PULSE_CLIENT',
    'ConvexPulseAngularClient',
    'injectAction',
    'injectMutation',
    'injectOnDataChange',
    'injectPrefetchQuery',
    'injectQuery',
    'skipToken'
  ])
})

it('skips an Angular query without requiring arguments or preparing a handle', async () => {
  const { client, socket } = setup()
  const context = createAngularContext(client)
  const query = context.run(() => injectQuery(tasksById, { args: 'skip' }))
  await socket.connected()

  expect(query().status).toBe('disabled')
  expect(client.devtools.getSnapshot().queries).toEqual([])
  expect(socket.querySetFrames()).toHaveLength(0)

  context.destroy()
  await client.close()
})

it('switches Angular query arguments reactively and cleans up each subscription', async () => {
  const { client, socket } = setup()
  const context = createAngularContext(client)
  const args = signal<{ id: string } | 'skip'>('skip')
  const query = context.run(() =>
    injectQuery(tasksById, { args: args.asReadonly() })
  )
  await socket.connected()
  expect(query().status).toBe('disabled')

  args.set({ id: 'one' })
  expect(query().status).toBe('pending')
  await vi.waitFor(() => expect(socket.querySetFrames()).toHaveLength(1))
  await socket.succeed(['one'])
  expect(query().data).toEqual(['one'])

  args.set({ id: 'two' })
  expect(query().status).toBe('pending')
  await vi.waitFor(() => {
    expect(socket.querySetFrames()).toHaveLength(3)
    expect(socket.removeFrames()).toHaveLength(1)
  })
  await socket.succeed(['two'], 1)
  expect(query().data).toEqual(['two'])

  args.set('skip')
  expect(query().status).toBe('disabled')
  await vi.waitFor(() => expect(socket.removeFrames()).toHaveLength(2))

  context.destroy()
  await client.close()
})

it('exposes Angular query state to devtools', async () => {
  const { client } = setup()
  const context = createAngularContext(client)
  context.run(() => injectQuery(tasks, { args: {} }))
  expect(client.devtools.getSnapshot().queries).toMatchObject([
    { status: 'pending' }
  ])
  context.destroy()
  await client.close()
})

it('reacts to live Angular query results and releases on destroy', async () => {
  const { client, socket } = setup()
  const context = createAngularContext(client)
  const query = context.run(() => injectQuery(tasks, { args: {} }))
  expect(query().status).toBe('pending')

  await socket.succeed(['Buy milk'])
  expect(query()).toMatchObject({ data: ['Buy milk'], status: 'success' })

  await socket.succeed(['Buy milk', 'Walk dog'])
  expect(query()).toMatchObject({
    data: ['Buy milk', 'Walk dog'],
    status: 'success'
  })

  context.destroy()
  expect(socket.removeFrames()).toHaveLength(1)
  await client.close()
})

it('updates an Angular query only when its selected value changes', async () => {
  const { client, socket } = setup()
  const optionListener = vi.fn()
  const standaloneListener = vi.fn()
  const context = createAngularContext(client)
  const query = context.run(() => {
    const result = injectQuery(tasks, {
      args: {},
      onDataChange: optionListener,
      select: (values) => values.filter((value) => !value.startsWith('done:'))
    })
    injectOnDataChange(result, standaloneListener)
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

  context.destroy()
  await client.close()
})

it('loads paginated Angular queries through injectQuery', async () => {
  const { client, socket } = setup()
  const context = createAngularContext(client)
  const query = context.run(() =>
    injectQuery(paginatedTasks, {
      args: {},
      pagination: { initialNumItems: 1 }
    })
  )
  await socket.succeed(pageResult(['one'], false, 'next'))
  query().loadMore(1)
  await socket.succeed(pageResult(['two'], true, 'done'), 1)
  expect(query().data).toEqual(['one', 'two'])
  context.destroy()
  await client.close()
})

it('subscribes only while an Angular query signal is enabled', async () => {
  const { client, socket } = setup()
  const context = createAngularContext(client)
  const enabled = signal(false)
  const query = context.run(() =>
    injectQuery(tasks, { args: {}, enabled: enabled.asReadonly() })
  )
  await socket.connected()

  expect(query().status).toBe('disabled')
  expect(socket.querySetFrames()).toHaveLength(0)

  enabled.set(true)
  expect(query().status).toBe('pending')
  await vi.waitFor(() => expect(socket.querySetFrames()).toHaveLength(1))

  await socket.succeed(['Buy milk'])
  expect(query().status).toBe('success')

  enabled.set(false)
  expect(query().status).toBe('disabled')
  await vi.waitFor(() => expect(socket.removeFrames()).toHaveLength(1))

  context.destroy()
  await client.close()
})

it('preserves and confirms an optimistic Angular mutation without duplication', async () => {
  const { client, socket } = setup()
  const context = createAngularContext(client)
  const { add, query } = context.run(() => ({
    add: injectMutation(setTask, {
      optimistic: ({ data, store }) => store.get(tasks).append(data.value)
    }),
    query: injectQuery(tasks, { args: {} })
  }))
  await socket.succeed(['Buy milk'])

  const mutation = add({ value: 'Call mom' })
  expect(query().data).toEqual(['Buy milk', 'Call mom'])

  await socket.resolveMutation('Call mom', ['Buy milk', 'Call mom'])
  await expect(mutation).resolves.toBe('Call mom')
  expect(query().data).toEqual(['Buy milk', 'Call mom'])

  context.destroy()
  await client.close()
})

it('rolls back a failed optimistic Angular mutation onto the latest server value', async () => {
  const { client, socket } = setup()
  const context = createAngularContext(client)
  const { add, query } = context.run(() => ({
    add: injectMutation(setTask, {
      optimistic: ({ data, store }) => store.get(tasks).append(data.value)
    }),
    query: injectQuery(tasks, { args: {} })
  }))
  await socket.succeed(['Buy milk'])

  const mutation = add({ value: 'Call mom' })
  await socket.succeed(['Buy milk', 'Pay rent'])
  expect(query().data).toEqual(['Buy milk', 'Pay rent', 'Call mom'])

  await socket.rejectMutation('Not allowed')
  await expect(mutation).rejects.toThrow('Not allowed')
  expect(query().data).toEqual(['Buy milk', 'Pay rent'])

  context.destroy()
  await client.close()
})

it('exposes query failures through the Angular signal', async () => {
  const { client, socket } = setup()
  const context = createAngularContext(client)
  const query = context.run(() => injectQuery(tasks, { args: {} }))

  await socket.fail('Not allowed')
  expect(query().status).toBe('error')
  expect(query().error).toMatchObject({ message: 'Not allowed' })

  context.destroy()
  await client.close()
})

it('throws Angular query failures from the computed signal when requested', async () => {
  const { client, socket } = setup()
  const context = createAngularContext(client)
  const query = context.run(() =>
    injectQuery(tasks, { args: {}, throwOnError: true })
  )

  await socket.fail('Not allowed')
  expect(() => query()).toThrow('Not allowed')

  context.destroy()
  await client.close()
})

it('resolves and cancels Angular prefetch handles', async () => {
  const { client, socket } = setup()
  const context = createAngularContext(client)
  const prefetch = context.run(() => injectPrefetchQuery(tasks))
  const successful = prefetch()

  await socket.succeed(['Buy milk'])
  await expect(successful.ready).resolves.toEqual(['Buy milk'])

  const canceled = prefetch()
  canceled.cancel()
  await expect(canceled.ready).rejects.toMatchObject({ name: 'AbortError' })

  context.destroy()
  await client.close()
})

it('resets active Angular queries on auth changes and closes the transport', async () => {
  const { client, socket } = setup()
  const context = createAngularContext(client)
  const query = context.run(() => injectQuery(tasks, { args: {} }))
  await socket.succeed(['Buy milk'])

  client.setAuth(() => Promise.resolve('token'))
  await vi.waitFor(() => expect(socket.authenticateFrames()).toHaveLength(1))
  await socket.confirmAuth()
  expect(query().status).toBe('pending')

  context.destroy()
  await client.close()
  expect(socket.readyState).toBe(3)
})

it('fetches an auth token from the Angular client options', async () => {
  const fetchToken = vi.fn(() => Promise.resolve('angular-token'))
  const client = new ConvexPulseAngularClient('https://example.convex.cloud', {
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
    value: 'angular-token'
  })
  await client.close()
})

it('forwards Angular query and mutation retry options', async () => {
  const { client, socket } = setup()
  const context = createAngularContext(client)
  const query = context.run(() => injectQuery(tasks, { args: {}, retries: 1 }))
  const mutation = context.run(() => injectMutation(setTask, { retries: 1 }))

  await socket.fail('first')
  expect(query().status).toBe('pending')
  await socket.succeed(['ready'], 1)
  expect(query().data).toEqual(['ready'])

  const result = mutation({ value: 'done' })
  await socket.rejectMutation('first')
  await vi.waitFor(() => expect(socket.mutationFrames()).toHaveLength(2))
  await socket.resolveMutation('done')
  await expect(result).resolves.toBe('done')

  context.destroy()
  await client.close()
})

it('exposes reactive Angular mutation state and reset', async () => {
  const { client, socket } = setup()
  const context = createAngularContext(client)
  const mutation = context.run(() => injectMutation(setTask))
  const label = computed(() => `${mutation.status}:${String(mutation.data)}`)

  const result = mutation({ value: 'done' })
  expect(label()).toBe('pending:undefined')
  await socket.resolveMutation('saved')
  await expect(result).resolves.toBe('saved')
  expect(label()).toBe('success:saved')

  mutation.reset()
  expect(label()).toBe('idle:undefined')
  context.destroy()
  await client.close()
})

it('exposes reactive Angular action state, callbacks, retries, and reset', async () => {
  const { client, socket } = setup()
  const context = createAngularContext(client)
  const onSuccess = vi.fn()
  const action = context.run(() =>
    injectAction(formatTask, { onSuccess, retries: 1 })
  )
  const label = computed(() => `${action.status}:${String(action.data)}`)

  const result = action({ value: 'docs' })
  expect(label()).toBe('pending:undefined')
  await socket.rejectAction('try again')
  await vi.waitFor(() => expect(socket.actionFrames()).toHaveLength(2))
  await socket.resolveAction('formatted')
  await expect(result).resolves.toBe('formatted')
  expect(label()).toBe('success:formatted')
  expect(onSuccess).toHaveBeenCalledWith({
    args: { value: 'docs' },
    data: 'formatted'
  })

  action.reset()
  expect(label()).toBe('idle:undefined')
  context.destroy()
  await client.close()
})

function setup() {
  const client = new ConvexPulseAngularClient('https://example.convex.cloud')
  const [socket] = FakeWebSocket.instances

  if (socket === undefined) {
    throw new Error('Expected the client to create a WebSocket')
  }

  return { client, socket }
}

function createAngularContext(client: ConvexPulseAngularClient) {
  const injector = Injector.create({
    providers: [{ provide: CONVEX_PULSE_CLIENT, useValue: client }]
  })

  return {
    destroy: () => injector.destroy(),
    run: <Result>(callback: () => Result) =>
      runInInjectionContext(injector, callback)
  }
}

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
function pageResult(values: string[], isDone: boolean, continueCursor: string) {
  return { continueCursor, isDone, page: values }
}
