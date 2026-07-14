import {
  ConvexPulseVueClient,
  provideConvexPulse,
  useAction,
  useMutation,
  useOnDataChange,
  usePrefetchQuery,
  useQuery
} from 'convex-pulse/vue'
import type { UseQueryOptions, VueQueryResult } from 'convex-pulse/vue'
import type { PaginationOptions, PaginationResult } from 'convex/server'
import { makeFunctionReference } from 'convex/server'
import { afterEach, beforeEach, expect, expectTypeOf, it, vi } from 'vitest'
import type { ComputedRef, ShallowRef } from 'vue'
import { computed, createApp, defineComponent, h, nextTick, ref } from 'vue'

import type { UseQueryPaginationResult } from '#client/Pagination.js'
import { FakeWebSocket } from '#testkit/FakeWebSocket.js'

beforeEach(() => {
  FakeWebSocket.instances.length = 0
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('keeps private framework internals out of the Vue runtime exports', async () => {
  const publicApi = await import('convex-pulse/vue')

  expect(Object.keys(publicApi).toSorted()).toEqual([
    'ConvexPulseVueClient',
    'ConvexPulseVueClientKey',
    'provideConvexPulse',
    'skipToken',
    'useAction',
    'useMutation',
    'useOnDataChange',
    'usePrefetchQuery',
    'useQuery'
  ])
})

it('skips a Vue query without requiring arguments or preparing a handle', async () => {
  const { client, socket } = setup()
  let query!: Readonly<ShallowRef<VueQueryResult<string[]>>>
  const app = mountWithClient(client, () => {
    query = useQuery(tasksById, { args: 'skip' })
  })
  await socket.connected()

  expect(query.value.status).toBe('disabled')
  expect(client.devtools.getSnapshot().queries).toEqual([])
  expect(socket.querySetFrames()).toHaveLength(0)

  app.unmount()
  await client.close()
})

it('switches Vue query arguments reactively and cleans up each subscription', async () => {
  const { client, socket } = setup()
  const args = ref<{ id: string } | 'skip'>('skip')
  let query!: Readonly<ShallowRef<VueQueryResult<string[]>>>
  const app = mountWithClient(client, () => {
    query = useQuery(tasksById, { args })
  })
  await socket.connected()
  expect(query.value.status).toBe('disabled')

  args.value = { id: 'one' }
  await nextTick()
  expect(query.value.status).toBe('pending')
  await vi.waitFor(() => expect(socket.querySetFrames()).toHaveLength(1))
  await socket.succeed(['one'])
  expect(query.value.data).toEqual(['one'])

  args.value = { id: 'two' }
  await nextTick()
  expect(query.value.status).toBe('pending')
  await vi.waitFor(() => {
    expect(socket.querySetFrames()).toHaveLength(3)
    expect(socket.removeFrames()).toHaveLength(1)
  })
  await socket.succeed(['two'], 1)
  expect(query.value.data).toEqual(['two'])

  args.value = 'skip'
  await nextTick()
  expect(query.value.status).toBe('disabled')
  await vi.waitFor(() => expect(socket.removeFrames()).toHaveLength(2))

  app.unmount()
  await client.close()
})

it('only includes disabled state for conditionally enabled Vue queries', async () => {
  const { client } = setup()
  const enabled = ref(false)
  const app = mountWithClient(client, () => {
    const options: UseQueryOptions<typeof tasks> = { args: {}, enabled }
    const conditionallyEnabled = useQuery(tasks, options)
    if (conditionallyEnabled.value.status === 'disabled') {
      expectTypeOf(conditionallyEnabled.value.data).toEqualTypeOf<undefined>()
    }

    const alwaysEnabled = useQuery(tasks, { args: {} })
    if (
      alwaysEnabled.value.status !== 'pending' &&
      alwaysEnabled.value.status !== 'error'
    ) {
      expectTypeOf(alwaysEnabled.value.data).toEqualTypeOf<string[]>()
    }
  })

  app.unmount()
  await client.close()
})

it('exposes Vue query state to devtools', async () => {
  const { client } = setup()
  const app = mountWithClient(client, () => useQuery(tasks, { args: {} }))
  expect(client.devtools.getSnapshot().queries).toMatchObject([
    { status: 'pending' }
  ])
  app.unmount()
  await client.close()
})

it('reacts to live Vue query results and releases on unmount', async () => {
  const { client, socket } = setup()
  let query!: Readonly<ShallowRef<VueQueryResult<string[]>>>
  const app = mountWithClient(client, () => {
    query = useQuery(tasks, { args: {} })
  })
  expect(query.value.status).toBe('pending')

  await socket.succeed(['Buy milk'])
  expect(query.value).toMatchObject({ data: ['Buy milk'], status: 'success' })

  await socket.succeed(['Buy milk', 'Walk dog'])
  expect(query.value).toMatchObject({
    data: ['Buy milk', 'Walk dog'],
    status: 'success'
  })

  app.unmount()
  expect(socket.removeFrames()).toHaveLength(1)
  await client.close()
})

it('updates a Vue query only when its selected value changes', async () => {
  const { client, socket } = setup()
  const optionListener = vi.fn()
  const standaloneListener = vi.fn()
  let query!: Readonly<ShallowRef<VueQueryResult<string[]>>>
  const app = mountWithClient(client, () => {
    query = useQuery(tasks, {
      args: {},
      onDataChange: optionListener,
      select: (values) => values.filter((value) => !value.startsWith('done:'))
    })
    useOnDataChange(query, standaloneListener)
  })

  await socket.succeed(['Buy milk'])
  const selected = query.value
  expect(selected.data).toEqual(['Buy milk'])
  expect(optionListener).not.toHaveBeenCalled()
  expect(standaloneListener).not.toHaveBeenCalled()

  await socket.succeed(['Buy milk', 'done: Walk dog'])
  expect(query.value).toBe(selected)
  expect(optionListener).not.toHaveBeenCalled()
  expect(standaloneListener).not.toHaveBeenCalled()

  await socket.succeed(['Buy milk', 'Walk dog'])
  expect(query.value).not.toBe(selected)
  expect(query.value.data).toEqual(['Buy milk', 'Walk dog'])
  const change = {
    next: ['Buy milk', 'Walk dog'],
    previous: ['Buy milk']
  }
  expect(optionListener).toHaveBeenCalledWith(change)
  expect(standaloneListener).toHaveBeenCalledWith(change)

  app.unmount()
  await client.close()
})

it('loads paginated Vue queries through useQuery', async () => {
  const { client, socket } = setup()
  let query!: Readonly<ShallowRef<UseQueryPaginationResult<string>>>
  const app = mountWithClient(client, () => {
    query = useQuery(paginatedTasks, {
      args: {},
      pagination: { initialNumItems: 1 }
    })
  })
  await socket.succeed(pageResult(['one'], false, 'next'))
  query.value.loadMore(1)
  await socket.succeed(pageResult(['two'], true, 'done'), 1)
  expect(query.value.data).toEqual(['one', 'two'])
  app.unmount()
  await client.close()
})

it('subscribes only while a Vue query is enabled', async () => {
  const { client, socket } = setup()
  const enabled = ref(false)
  let query!: Readonly<ShallowRef<VueQueryResult<string[]>>>
  const app = mountWithClient(client, () => {
    query = useQuery(tasks, { args: {}, enabled })
  })
  await socket.connected()

  expect(query.value.status).toBe('disabled')
  expect(socket.querySetFrames()).toHaveLength(0)

  enabled.value = true
  await nextTick()
  await vi.waitFor(() => expect(socket.querySetFrames()).toHaveLength(1))
  expect(query.value.status).toBe('pending')

  await socket.succeed(['Buy milk'])
  expect(query.value.status).toBe('success')

  enabled.value = false
  await nextTick()
  await vi.waitFor(() => expect(socket.removeFrames()).toHaveLength(1))
  expect(query.value.status).toBe('disabled')

  app.unmount()
  await client.close()
})

it('preserves and confirms an optimistic Vue mutation without duplication', async () => {
  const { client, socket } = setup()
  let query!: Readonly<ShallowRef<VueQueryResult<string[]>>>
  let add!: ReturnType<typeof useMutation<typeof setTask>>
  const app = mountWithClient(client, () => {
    query = useQuery(tasks, { args: {} })
    add = useMutation(setTask, {
      optimistic: ({ data, store }) => store.get(tasks).append(data.value)
    })
  })
  await socket.succeed(['Buy milk'])

  const mutation = add({ value: 'Call mom' })
  expect(query.value.data).toEqual(['Buy milk', 'Call mom'])

  await socket.resolveMutation('Call mom', ['Buy milk', 'Call mom'])
  await expect(mutation).resolves.toBe('Call mom')
  expect(query.value.data).toEqual(['Buy milk', 'Call mom'])

  app.unmount()
  await client.close()
})

it('rolls back a failed optimistic Vue mutation onto the latest server value', async () => {
  const { client, socket } = setup()
  let query!: Readonly<ShallowRef<VueQueryResult<string[]>>>
  let add!: ReturnType<typeof useMutation<typeof setTask>>
  const app = mountWithClient(client, () => {
    query = useQuery(tasks, { args: {} })
    add = useMutation(setTask, {
      optimistic: ({ data, store }) => store.get(tasks).append(data.value)
    })
  })
  await socket.succeed(['Buy milk'])

  const mutation = add({ value: 'Call mom' })
  await socket.succeed(['Buy milk', 'Pay rent'])
  expect(query.value.data).toEqual(['Buy milk', 'Pay rent', 'Call mom'])

  await socket.rejectMutation('Not allowed')
  await expect(mutation).rejects.toThrow('Not allowed')
  expect(query.value.data).toEqual(['Buy milk', 'Pay rent'])

  app.unmount()
  await client.close()
})

it('exposes query failures through the Vue shallow ref', async () => {
  const { client, socket } = setup()
  let query!: Readonly<ShallowRef<VueQueryResult<string[]>>>
  const app = mountWithClient(client, () => {
    query = useQuery(tasks, { args: {} })
  })

  await socket.fail('Not allowed')
  expect(query.value.status).toBe('error')
  expect(query.value.error).toMatchObject({ message: 'Not allowed' })

  app.unmount()
  await client.close()
})

it('throws Vue query failures from the computed ref when requested', async () => {
  const { client, socket } = setup()
  let query!: Readonly<ShallowRef<VueQueryResult<string[], true>>>
  const app = mountWithClient(client, () => {
    query = useQuery(tasks, { args: {}, throwOnError: true })
  })

  await socket.fail('Not allowed')
  expect(() => query.value).toThrow('Not allowed')

  app.unmount()
  await client.close()
})

it('resolves and cancels Vue prefetch handles', async () => {
  const { client, socket } = setup()
  let prefetch!: ReturnType<typeof usePrefetchQuery<typeof tasks>>
  const app = mountWithClient(client, () => {
    prefetch = usePrefetchQuery(tasks)
  })
  const successful = prefetch()

  await socket.succeed(['Buy milk'])
  await expect(successful.ready).resolves.toEqual(['Buy milk'])

  const canceled = prefetch()
  canceled.cancel()
  await expect(canceled.ready).rejects.toMatchObject({ name: 'AbortError' })

  app.unmount()
  await client.close()
})

it('requires a provided Vue client', () => {
  vi.spyOn(console, 'warn').mockImplementation(noop)
  const child = defineComponent({
    setup() {
      useQuery(tasks, { args: {} })

      return () => null
    }
  })
  const element = document.createElement('div')

  expect(() => createApp(child).mount(element)).toThrow(
    'Convex Pulse Vue client was not provided'
  )
})

it('resets active Vue queries on auth changes and closes the transport', async () => {
  const { client, socket } = setup()
  let query!: Readonly<ShallowRef<VueQueryResult<string[]>>>
  const app = mountWithClient(client, () => {
    query = useQuery(tasks, { args: {} })
  })
  await socket.succeed(['Buy milk'])

  client.setAuth(() => Promise.resolve('token'))
  await vi.waitFor(() => expect(socket.authenticateFrames()).toHaveLength(1))
  await socket.confirmAuth()
  expect(query.value.status).toBe('pending')

  app.unmount()
  await client.close()
  expect(socket.readyState).toBe(3)
})

it('fetches an auth token from the Vue client options', async () => {
  const fetchToken = vi.fn(() => Promise.resolve('vue-token'))
  const client = new ConvexPulseVueClient('https://example.convex.cloud', {
    fetchToken
  })
  const [socket] = FakeWebSocket.instances
  if (socket === undefined) {
    throw new Error('Expected the client to create a WebSocket')
  }

  await socket.connected()
  await vi.waitFor(() => expect(socket.authenticateFrames()).toHaveLength(1))

  expect(fetchToken).toHaveBeenCalledWith({ forceRefreshToken: false })
  expect(socket.authenticateFrames()[0]).toMatchObject({ value: 'vue-token' })
  await client.close()
})

it('forwards Vue query and mutation retry options', async () => {
  const { client, socket } = setup()
  let query!: Readonly<ShallowRef<VueQueryResult<string[]>>>
  let mutation!: ReturnType<typeof useMutation<typeof setTask>>
  const app = mountWithClient(client, () => {
    query = useQuery(tasks, { args: {}, retries: 1 })
    mutation = useMutation(setTask, { retries: 1 })
  })

  await socket.fail('first')
  expect(query.value.status).toBe('pending')
  await socket.succeed(['ready'], 1)
  expect(query.value.data).toEqual(['ready'])

  const result = mutation({ value: 'done' })
  await socket.rejectMutation('first')
  await vi.waitFor(() => expect(socket.mutationFrames()).toHaveLength(2))
  await socket.resolveMutation('done')
  await expect(result).resolves.toBe('done')

  app.unmount()
  await client.close()
})

it('exposes reactive Vue mutation state and reset', async () => {
  const { client, socket } = setup()
  let mutation!: ReturnType<typeof useMutation<typeof setTask>>
  let label!: ComputedRef<string>
  const app = mountWithClient(client, () => {
    mutation = useMutation(setTask)
    label = computed(() => `${mutation.status}:${String(mutation.data)}`)
  })

  const result = mutation({ value: 'done' })
  expect(label.value).toBe('pending:undefined')
  await socket.resolveMutation('saved')
  await expect(result).resolves.toBe('saved')
  expect(label.value).toBe('success:saved')

  mutation.reset()
  expect(label.value).toBe('idle:undefined')
  app.unmount()
  await client.close()
})

it('exposes reactive Vue action state, callbacks, retries, and reset', async () => {
  const { client, socket } = setup()
  const onSuccess = vi.fn()
  let action!: ReturnType<typeof useAction<typeof formatTask>>
  let label!: ComputedRef<string>
  const app = mountWithClient(client, () => {
    action = useAction(formatTask, { onSuccess, retries: 1 })
    label = computed(() => `${action.status}:${String(action.data)}`)
  })

  const result = action({ value: 'docs' })
  expect(label.value).toBe('pending:undefined')
  await socket.rejectAction('try again')
  await vi.waitFor(() => expect(socket.actionFrames()).toHaveLength(2))
  await socket.resolveAction('formatted')
  await expect(result).resolves.toBe('formatted')
  expect(label.value).toBe('success:formatted')
  expect(onSuccess).toHaveBeenCalledWith({
    args: { value: 'docs' },
    data: 'formatted'
  })

  action.reset()
  expect(label.value).toBe('idle:undefined')
  app.unmount()
  await client.close()
})

function setup() {
  const client = new ConvexPulseVueClient('https://example.convex.cloud')
  const [socket] = FakeWebSocket.instances

  if (socket === undefined) {
    throw new Error('Expected the client to create a WebSocket')
  }

  return { client, socket }
}

function mountWithClient(client: ConvexPulseVueClient, setupChild: () => void) {
  const child = defineComponent({
    setup() {
      setupChild()

      return () => null
    }
  })
  const root = defineComponent({
    setup() {
      provideConvexPulse(client)

      return () => h(child)
    }
  })
  const app = createApp(root)

  app.mount(document.createElement('div'))

  return app
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
function pageResult(values: string[], isDone: boolean, continueCursor: string) {
  return { continueCursor, isDone, page: values }
}
