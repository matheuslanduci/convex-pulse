import type { PaginationResult } from 'convex/server'
import { expect, it, vi } from 'vitest'

import { QueryCore } from '#client/QueryCore.js'
import type { SyncQueryResult } from '#client/SyncClient.js'

class FakeQueryDriver {
  readonly mutations: PendingMutation[] = []
  readonly subscriptions: Subscription[] = []
  readonly transitionListeners = new Set<MutationTransitionListener>()
  mutationError: Error | null = null

  subscribe(query: QueryDescriptor, listener: QueryListener) {
    const subscription = { listener, query, released: false }
    this.subscriptions.push(subscription)
    return () => {
      subscription.released = true
    }
  }

  mutationWithId(mutation: MutationDescriptor) {
    if (this.mutationError !== null) {
      throw this.mutationError
    }
    const pending = deferred<unknown>()
    const requestId = this.mutations.length
    this.mutations.push({ ...pending, mutation, requestId })
    return { promise: pending.promise, requestId }
  }

  subscribeMutationTransitions(listener: MutationTransitionListener) {
    this.transitionListeners.add(listener)
    return () => this.transitionListeners.delete(listener)
  }

  publish(result: SyncQueryResult, index = 0) {
    const subscription = this.subscriptions[index]
    if (subscription === undefined) {
      throw new Error(`Missing subscription ${index}`)
    }
    subscription.listener(result)
  }

  resolveMutation(value: unknown, index = 0) {
    const mutation = this.mutations[index]
    if (mutation === undefined) {
      throw new Error(`Missing mutation ${index}`)
    }
    mutation.resolve(value)
  }

  rejectMutation(error: Error, index = 0) {
    const mutation = this.mutations[index]
    if (mutation === undefined) {
      throw new Error(`Missing mutation ${index}`)
    }
    mutation.reject(error)
  }

  transition(requestIds: readonly number[], publish: () => void) {
    for (const listener of this.transitionListeners) {
      listener.begin(requestIds)
    }
    publish()
    for (const listener of this.transitionListeners) {
      listener.end()
    }
  }
}

function deferred<Data>() {
  let rejectPromise!: (error: unknown) => void
  let resolvePromise!: (value: Data) => void
  const promise = new Promise<Data>((resolve, reject) => {
    rejectPromise = reject
    resolvePromise = resolve
  })
  return { promise, reject: rejectPromise, resolve: resolvePromise }
}

function noop() {
  void 0
}

it('shares canonical query cells and releases the driver after the final subscriber', () => {
  const driver = new FakeQueryDriver()
  const core = new QueryCore(driver)
  const first = core.prepareQuery<string>('tasks:get', { a: 1, b: 2 })
  const reorderedArgs = Object.fromEntries([
    ['b', 2],
    ['a', 1]
  ])
  const second = core.prepareQuery<string>('tasks:get', reorderedArgs)
  const firstListener = vi.fn()
  const secondListener = vi.fn()

  const releaseFirst = first.subscribe(firstListener)
  const releaseSecond = second.subscribe(secondListener)
  expect(first).toBe(second)
  expect(driver.subscriptions).toHaveLength(1)

  driver.publish({ status: 'success', value: 'ready' })
  expect(first.getSnapshot()).toMatchObject({
    data: 'ready',
    status: 'success'
  })
  expect(firstListener).toHaveBeenCalledOnce()
  expect(secondListener).toHaveBeenCalledOnce()

  releaseFirst()
  releaseFirst()
  expect(driver.subscriptions[0]?.released).toBe(false)
  releaseSecond()
  expect(driver.subscriptions[0]?.released).toBe(true)
})

it('replays optimistic layers over live updates and rolls back to the latest base', async () => {
  const driver = new FakeQueryDriver()
  const core = new QueryCore(driver)
  const query = core.prepareQuery<string[]>('tasks:list', {})
  query.subscribe(vi.fn())
  driver.publish({ status: 'success', value: ['Buy milk'] })

  const mutation = core.mutation(
    'tasks:add',
    { value: 'Call mom' },
    undefined,
    ({ store }) => store.get('tasks:list', {}).append('Call mom')
  )
  expect(query.getSnapshot().data).toEqual(['Buy milk', 'Call mom'])

  driver.publish({
    status: 'success',
    value: ['Buy milk', 'Pay rent']
  })
  expect(query.getSnapshot().data).toEqual(['Buy milk', 'Pay rent', 'Call mom'])

  driver.rejectMutation(new Error('Not allowed'))
  await expect(mutation).rejects.toThrow('Not allowed')
  expect(query.getSnapshot().data).toEqual(['Buy milk', 'Pay rent'])
  expect(core.getDevtoolsSnapshot().optimisticEvents[0]).toMatchObject({
    type: 'rolled-back'
  })
})

it('removes reflected optimism before publishing its confirmed query result', async () => {
  const driver = new FakeQueryDriver()
  const core = new QueryCore(driver)
  const query = core.prepareQuery<string[]>('tasks:list', {})
  const valueList: string[][] = []
  query.subscribe(() => {
    const snapshot = query.getSnapshot()
    if (snapshot.status === 'success') {
      valueList.push(snapshot.data)
    }
  })
  driver.publish({ status: 'success', value: ['Buy milk'] })

  const mutation = core.mutation(
    'tasks:add',
    { value: 'Call mom' },
    undefined,
    ({ store }) => store.get('tasks:list', {}).append('Call mom')
  )
  driver.transition([0], () => {
    driver.publish({
      status: 'success',
      value: ['Buy milk', 'Call mom']
    })
  })
  driver.resolveMutation('Call mom')
  await mutation

  expect(valueList).toEqual([
    ['Buy milk'],
    ['Buy milk', 'Call mom'],
    ['Buy milk', 'Call mom']
  ])
})

it('removes only reflected layers while preserving a newer base and later layers', async () => {
  const driver = new FakeQueryDriver()
  const core = new QueryCore(driver)
  const query = core.prepareQuery<string[]>('tasks:list', {})
  const valueList: string[][] = []
  query.subscribe(() => {
    const snapshot = query.getSnapshot()
    if (snapshot.status === 'success') {
      valueList.push(snapshot.data)
    }
  })
  driver.publish({ status: 'success', value: [] })
  const first = core.mutation(
    'tasks:add',
    { value: 'First' },
    undefined,
    ({ store }) => store.get('tasks:list', {}).append('First')
  )
  const second = core.mutation(
    'tasks:add',
    { value: 'Second' },
    undefined,
    ({ store }) => store.get('tasks:list', {}).append('Second')
  )

  driver.publish({ status: 'success', value: ['Remote'] })
  driver.transition([0], noop)
  driver.resolveMutation('First', 0)
  await first
  expect(query.getSnapshot().data).toEqual(['Remote', 'Second'])

  driver.transition([1], () => {
    driver.publish({
      status: 'success',
      value: ['Remote', 'First', 'Second']
    })
  })
  driver.resolveMutation('Second', 1)
  await second
  expect(query.getSnapshot().data).toEqual(['Remote', 'First', 'Second'])
  expect(valueList).not.toContainEqual(['Remote', 'First', 'Second', 'Second'])
})

it('deduplicates equivalent pending mutations and releases keys after settlement', async () => {
  const driver = new FakeQueryDriver()
  const core = new QueryCore(driver)

  const first = core.mutation('tasks:remove', { id: 'one' }, 'one')
  const second = core.mutation('tasks:remove', { id: 'one' }, 'one')
  expect(second).toBe(first)
  expect(driver.mutations).toHaveLength(1)

  driver.resolveMutation(null)
  await expect(Promise.all([first, second])).resolves.toEqual([null, null])

  const retry = core.mutation('tasks:remove', { id: 'one' }, 'one')
  expect(driver.mutations).toHaveLength(2)
  driver.resolveMutation(null, 1)
  await expect(retry).resolves.toBeNull()
})

it('cleans up every active shared query when the core closes', () => {
  const driver = new FakeQueryDriver()
  const core = new QueryCore(driver)
  const first = core.prepareQuery<string>('tasks:get', { id: 'one' })
  const second = core.prepareQuery<string>('tasks:get', { id: 'two' })
  first.subscribe(vi.fn())
  second.subscribe(vi.fn())

  core.close()
  core.close()

  expect(driver.subscriptions).toHaveLength(2)
  expect(driver.subscriptions.every(({ released }) => released)).toBe(true)
})

it('replays current results only to subscribers joining an active query', () => {
  const driver = new FakeQueryDriver()
  const core = new QueryCore(driver)
  const query = core.prepareQuery<string>('tasks:get', {})
  const releaseFirst = query.subscribe(vi.fn())
  driver.publish({ status: 'success', value: 'ready' })
  const joiningListener = vi.fn()

  query.subscribeWithCurrent(joiningListener)
  expect(joiningListener).toHaveBeenCalledOnce()

  releaseFirst()
  core.close()
  const retained = core.prepareQuery<string>('tasks:get', {})
  const inactiveListener = vi.fn()
  retained.subscribeWithCurrent(inactiveListener)
  expect(inactiveListener).not.toHaveBeenCalled()
})

it('isolates active and inactive query snapshots across auth scopes', () => {
  const driver = new FakeQueryDriver()
  const core = new QueryCore(driver)
  const active = core.prepareQuery<string>('tasks:active', {})
  const inactive = core.prepareQuery<string>('tasks:inactive', {})
  const listener = vi.fn()
  active.subscribe(listener)
  driver.publish({ status: 'success', value: 'ready' })
  const releaseInactive = inactive.subscribe(noop)
  driver.publish({ status: 'success', value: 'private' }, 1)
  releaseInactive()

  core.resetAuthScope()
  expect(active.getSnapshot().status).toBe('pending')
  expect(inactive.getSnapshot().status).toBe('pending')
  expect(listener).toHaveBeenCalledTimes(2)
  expect(core.getDevtoolsSnapshot().queries).toHaveLength(1)

  inactive.subscribe(noop)
  expect(driver.subscriptions).toHaveLength(3)
  expect(inactive.getSnapshot().status).toBe('pending')
  driver.publish({ status: 'success', value: 'anonymous' }, 2)
  expect(inactive.getSnapshot()).toMatchObject({
    data: 'anonymous',
    status: 'success'
  })

  const error = new Error('Query failed')
  driver.publish({ error, status: 'error' })
  expect(active.getSnapshot()).toMatchObject({ error, status: 'error' })
  expect(active.getResult()).toEqual({ error, status: 'error' })
})

it('drops optimistic layers and dedupe ownership from the previous auth scope', async () => {
  const driver = new FakeQueryDriver()
  const core = new QueryCore(driver)
  const query = core.prepareQuery<string[]>('tasks:list', {})
  query.subscribe(noop)
  driver.publish({ status: 'success', value: ['private'] })

  const oldMutation = core.mutation(
    'tasks:add',
    { value: 'optimistic' },
    'same',
    ({ store }) => store.get('tasks:list', {}).append('optimistic')
  )
  expect(query.getSnapshot().data).toEqual(['private', 'optimistic'])

  core.resetAuthScope()
  expect(query.getSnapshot().status).toBe('pending')
  expect(core.getDevtoolsSnapshot().optimisticEvents[0]).toMatchObject({
    type: 'auth-removed'
  })
  driver.publish({ status: 'success', value: ['anonymous'] })
  expect(query.getSnapshot().data).toEqual(['anonymous'])

  const newMutation = core.mutation('tasks:add', { value: 'new' }, 'same')
  expect(newMutation).not.toBe(oldMutation)
  expect(driver.mutations).toHaveLength(2)

  driver.resolveMutation('old', 0)
  driver.resolveMutation('new', 1)
  await expect(oldMutation).resolves.toBe('old')
  await expect(newMutation).resolves.toBe('new')
})

it('retries a failed query up to its configured additional-attempt count', () => {
  const driver = new FakeQueryDriver()
  const core = new QueryCore(driver)
  const query = core.prepareQuery<string>('tasks:get', {}, 2)
  const listener = vi.fn()
  query.subscribe(listener)

  driver.publish({ error: new Error('first'), status: 'error' })
  expect(query.getSnapshot().status).toBe('pending')
  expect(driver.subscriptions).toHaveLength(2)
  driver.publish({ error: new Error('second'), status: 'error' }, 1)
  expect(query.getSnapshot().status).toBe('pending')
  expect(driver.subscriptions).toHaveLength(3)
  driver.publish({ status: 'success', value: 'ready' }, 2)

  expect(query.getSnapshot()).toMatchObject({
    data: 'ready',
    status: 'success'
  })
  expect(listener).toHaveBeenCalledTimes(3)
})

it('exposes ordered optimistic layers and deduplicated callers to devtools', async () => {
  const driver = new FakeQueryDriver()
  const core = new QueryCore(driver, { now: () => 123 })
  const query = core.prepareQuery<string[]>('tasks:list', {})
  query.subscribe(noop)
  driver.publish({ status: 'success', value: ['server'] })

  const first = core.mutation(
    'tasks:add',
    { value: 'optimistic' },
    'shared',
    ({ store }) => store.get('tasks:list', {}).append('optimistic')
  )
  const second = core.mutation('tasks:add', { value: 'optimistic' }, 'shared')
  driver.publish({ status: 'success', value: ['server', 'remote'] })

  expect(second).toBe(first)
  expect(core.getDevtoolsSnapshot()).toMatchObject({
    deduplicatedMutations: [
      {
        callerCount: 2,
        path: 'tasks:add',
        requestId: 0
      }
    ],
    optimisticEvents: [
      expect.objectContaining({
        path: 'tasks:add',
        queryPath: 'tasks:list',
        type: 'replayed'
      }),
      expect.objectContaining({ path: 'tasks:add', type: 'created' })
    ],
    optimisticLayers: [
      {
        args: { value: 'optimistic' },
        index: 0,
        operations: [
          {
            args: {},
            path: 'tasks:list',
            type: 'append',
            value: 'optimistic'
          }
        ],
        path: 'tasks:add',
        requestId: 0,
        startedAt: 123
      }
    ],
    queries: [
      expect.objectContaining({
        data: ['server', 'remote', 'optimistic'],
        serverData: ['server', 'remote']
      })
    ]
  })

  driver.resolveMutation('optimistic')
  await first
  expect(core.getDevtoolsSnapshot()).toMatchObject({
    deduplicatedMutations: [],
    optimisticLayers: []
  })
  expect(core.getDevtoolsSnapshot().optimisticEvents[0]).toMatchObject({
    type: 'confirmed'
  })
})

it('exposes the final query error after exhausting retries', () => {
  const driver = new FakeQueryDriver()
  const core = new QueryCore(driver)
  const query = core.prepareQuery<string>('tasks:get', {}, 1)
  query.subscribe(noop)

  driver.publish({ error: new Error('first'), status: 'error' })
  driver.publish({ error: new Error('final'), status: 'error' }, 1)

  expect(query.getSnapshot()).toMatchObject({
    error: expect.objectContaining({ message: 'final' }),
    status: 'error'
  })
  expect(driver.subscriptions).toHaveLength(2)
})

it('retries mutations while preserving one optimistic layer', async () => {
  const driver = new FakeQueryDriver()
  const core = new QueryCore(driver)
  const query = core.prepareQuery<string[]>('tasks:list', {})
  query.subscribe(noop)
  driver.publish({ status: 'success', value: [] })
  const mutation = core.mutation(
    'tasks:add',
    { value: 'Call mom' },
    undefined,
    ({ store }) => store.get('tasks:list', {}).append('Call mom'),
    1
  )

  driver.rejectMutation(new Error('first'))
  await Promise.resolve()
  expect(driver.mutations).toHaveLength(2)
  expect(query.getSnapshot().data).toEqual(['Call mom'])
  driver.resolveMutation('Call mom', 1)

  await expect(mutation).resolves.toBe('Call mom')
  expect(query.getSnapshot().data).toEqual([])
})

it('rejects invalid retry counts before sending an operation', () => {
  const driver = new FakeQueryDriver()
  const core = new QueryCore(driver)

  expect(() => core.prepareQuery('tasks:get', {}, -1)).toThrow(
    'retries must be a non-negative safe integer'
  )
  expect(() =>
    core.mutation('tasks:add', {}, undefined, undefined, 1.5)
  ).toThrow('retries must be a non-negative safe integer')
  expect(driver.mutations).toHaveLength(0)
})

it('applies shape-aware optimistic operations and restores each server base', async () => {
  const driver = new FakeQueryDriver()
  const core = new QueryCore(driver)
  const array = core.prepareQuery<unknown>('values:array', {})
  const object = core.prepareQuery<unknown>('values:object', {})
  const primitive = core.prepareQuery<unknown>('values:primitive', {})
  array.subscribe(vi.fn())
  object.subscribe(vi.fn())
  primitive.subscribe(vi.fn())
  driver.publish({ status: 'success', value: 'not-an-array' })
  driver.publish({ status: 'success', value: { count: 1 } }, 1)
  driver.publish({ status: 'success', value: 'idle' }, 2)

  const mutation = core.mutation(
    'values:update',
    {},
    undefined,
    ({ store }) => {
      store.get('values:array', {}).append('ignored')
      store.get('values:object', {}).merge({ label: 'optimistic' })
      store.get('values:primitive', {}).modify('saving')
    }
  )
  expect(array.getSnapshot().data).toBe('not-an-array')
  expect(object.getSnapshot().data).toEqual({
    count: 1,
    label: 'optimistic'
  })
  expect(primitive.getSnapshot().data).toBe('saving')

  driver.resolveMutation(null)
  await mutation
  expect(object.getSnapshot().data).toEqual({ count: 1 })
  expect(primitive.getSnapshot().data).toBe('idle')
})

it('applies keyed optimistic collection operations by stable or selected keys', async () => {
  const driver = new FakeQueryDriver()
  const core = new QueryCore(driver)
  const query = core.prepareQuery<Task[]>('tasks:list', {})
  query.subscribe(vi.fn())
  driver.publish({
    status: 'success',
    value: [
      { _id: 'a', label: 'A', rank: 1 },
      { _id: 'b', label: 'B', rank: 2 },
      { _id: 'c', label: 'C', rank: 3 }
    ]
  })

  const mutation = core.mutation('tasks:change', {}, undefined, ({ store }) => {
    const tasks = store.get('tasks:list', {})
    tasks.prepend({ _id: 'zero', label: 'Zero', rank: 0 })
    tasks.insert(
      { _id: 'between', label: 'Between', rank: 1.5 },
      { after: 1, keyBy: (value) => (value as Task).rank }
    )
    tasks.update('b', { label: 'B updated' })
    tasks.remove('c')
    tasks.replace('a', { _id: 'a', label: 'A replaced', rank: 1 })
    tasks.upsert({ _id: 'between', label: 'Between upserted', rank: 1.5 })
    tasks.upsert({ _id: 'd', label: 'D', rank: 4 })
  })

  expect(query.getSnapshot().data).toEqual([
    { _id: 'zero', label: 'Zero', rank: 0 },
    { _id: 'a', label: 'A replaced', rank: 1 },
    { _id: 'between', label: 'Between upserted', rank: 1.5 },
    { _id: 'b', label: 'B updated', rank: 2 },
    { _id: 'd', label: 'D', rank: 4 }
  ])

  driver.publish({
    status: 'success',
    value: [
      { _id: 'a', label: 'Remote A', rank: 1 },
      { _id: 'b', label: 'Remote B', rank: 2 },
      { _id: 'c', label: 'Remote C', rank: 3 }
    ]
  })
  expect(query.getSnapshot().data).toEqual([
    { _id: 'zero', label: 'Zero', rank: 0 },
    { _id: 'a', label: 'A replaced', rank: 1 },
    { _id: 'between', label: 'Between upserted', rank: 1.5 },
    { _id: 'b', label: 'B updated', rank: 2 },
    { _id: 'd', label: 'D', rank: 4 }
  ])

  driver.rejectMutation(new Error('Not allowed'))
  await expect(mutation).rejects.toThrow('Not allowed')
  expect(query.getSnapshot().data).toEqual([
    { _id: 'a', label: 'Remote A', rank: 1 },
    { _id: 'b', label: 'Remote B', rank: 2 },
    { _id: 'c', label: 'Remote C', rank: 3 }
  ])
})

it('keeps keyed collection operations unchanged when their target is missing', async () => {
  const driver = new FakeQueryDriver()
  const core = new QueryCore(driver)
  const query = core.prepareQuery<string[]>('values:list', {})
  query.subscribe(vi.fn())
  driver.publish({ status: 'success', value: ['a', 'b'] })

  const mutation = core.mutation(
    'values:change',
    {},
    undefined,
    ({ store }) => {
      const values = store.get('values:list', {})
      values.insert('x', { before: 'missing' })
      values.update('missing', 'changed')
      values.remove('missing')
      values.replace('missing', 'changed')
    }
  )

  expect(query.getSnapshot().data).toEqual(['a', 'b'])
  driver.resolveMutation(null)
  await mutation
})

it('applies optimistic operations across matching paginated query pages', async () => {
  const driver = new FakeQueryDriver()
  const core = new QueryCore(driver)
  const first = core.prepareQuery<PaginationResult<Task>>('tasks:paginate', {
    channel: 'general',
    paginationOpts: { cursor: null, id: 1, numItems: 2 }
  })
  const last = core.prepareQuery<PaginationResult<Task>>('tasks:paginate', {
    channel: 'general',
    paginationOpts: { cursor: 'next', id: 1, numItems: 2 }
  })
  const unrelated = core.prepareQuery<PaginationResult<Task>>(
    'tasks:paginate',
    {
      channel: 'random',
      paginationOpts: { cursor: null, id: 2, numItems: 2 }
    }
  )
  first.subscribe(noop)
  last.subscribe(noop)
  unrelated.subscribe(noop)
  const firstPage = pageResult(
    [
      { _id: 'a', label: 'A', rank: 1 },
      { _id: 'b', label: 'B', rank: 2 }
    ],
    false,
    'next'
  )
  const lastPage = pageResult([{ _id: 'c', label: 'C', rank: 3 }], true, 'done')
  driver.publish({ status: 'success', value: firstPage })
  driver.publish({ status: 'success', value: lastPage }, 1)
  driver.publish({ status: 'success', value: firstPage }, 2)

  const mutation = core.mutation('tasks:change', {}, undefined, ({ store }) => {
    const tasks = store.paginated('tasks:paginate', { channel: 'general' })
    tasks.prepend({ _id: 'zero', label: 'Zero', rank: 0 })
    tasks.update('b', { label: 'B updated' })
    tasks.replace('a', { _id: 'a', label: 'A replaced', rank: 1 })
    tasks.remove('c')
    tasks.appendIfLoaded({ _id: 'd', label: 'D', rank: 4 })
  })

  expect(first.getSnapshot().data?.page).toEqual([
    { _id: 'zero', label: 'Zero', rank: 0 },
    { _id: 'a', label: 'A replaced', rank: 1 },
    { _id: 'b', label: 'B updated', rank: 2 }
  ])
  expect(last.getSnapshot().data?.page).toEqual([
    { _id: 'd', label: 'D', rank: 4 }
  ])
  expect(unrelated.getSnapshot().data).toEqual(firstPage)

  driver.rejectMutation(new Error('Not allowed'))
  await expect(mutation).rejects.toThrow('Not allowed')
  expect(first.getSnapshot().data).toEqual(firstPage)
  expect(last.getSnapshot().data).toEqual(lastPage)
})

it('does not send a mutation or retain a layer when its optimistic recipe throws', () => {
  const driver = new FakeQueryDriver()
  const core = new QueryCore(driver)
  const query = core.prepareQuery<string[]>('tasks:list', {})
  query.subscribe(vi.fn())
  driver.publish({ status: 'success', value: [] })

  expect(() =>
    core.mutation('tasks:add', {}, undefined, ({ store }) => {
      store.get('tasks:list', {}).append('partial')
      throw new Error('Recipe failed')
    })
  ).toThrow('Recipe failed')
  expect(driver.mutations).toHaveLength(0)
  expect(query.getSnapshot().data).toEqual([])
})

it('removes optimism when the private mutation driver throws before sending', () => {
  const driver = new FakeQueryDriver()
  const core = new QueryCore(driver)
  const query = core.prepareQuery<string[]>('tasks:list', {})
  query.subscribe(vi.fn())
  driver.publish({ status: 'success', value: [] })
  driver.mutationError = new Error('Transport failed')

  expect(() =>
    core.mutation('tasks:add', {}, undefined, ({ store }) => {
      store.get('tasks:list', {}).append('partial')
    })
  ).toThrow('Transport failed')
  expect(query.getSnapshot().data).toEqual([])
})

it('releases a failed deduplication key so a later retry can run', async () => {
  const driver = new FakeQueryDriver()
  const core = new QueryCore(driver)
  const failed = core.mutation('tasks:remove', { id: 'one' }, 'one')

  driver.rejectMutation(new Error('Not allowed'))
  await expect(failed).rejects.toThrow('Not allowed')

  const retry = core.mutation('tasks:remove', { id: 'one' }, 'one')
  expect(driver.mutations).toHaveLength(2)
  driver.resolveMutation(null, 1)
  await expect(retry).resolves.toBeNull()
})

it('reports query lifecycle state and garbage collects inactive cache entries', () => {
  vi.useFakeTimers()
  try {
    vi.setSystemTime(1000)
    const driver = new FakeQueryDriver()
    const core = new QueryCore(driver, { gcTime: 300_000 })
    const listener = vi.fn()
    const releaseDevtools = core.subscribeDevtools(listener)
    const query = core.prepareQuery<string>('tasks:get', { id: 'one' })

    expect(core.getDevtoolsSnapshot().queries).toEqual([
      expect.objectContaining({
        expiresAt: 301_000,
        path: 'tasks:get',
        status: 'pending',
        subscriberCount: 0
      })
    ])

    const release = query.subscribe(noop)
    expect(core.getDevtoolsSnapshot().queries[0]).toEqual(
      expect.objectContaining({ expiresAt: null, subscriberCount: 1 })
    )
    driver.publish({ status: 'success', value: 'ready' })
    expect(core.getDevtoolsSnapshot().queries[0]).toEqual(
      expect.objectContaining({
        data: 'ready',
        status: 'success',
        updatedAt: 1000
      })
    )

    release()
    expect(core.getDevtoolsSnapshot().queries[0]).toEqual(
      expect.objectContaining({ expiresAt: 301_000, subscriberCount: 0 })
    )
    vi.advanceTimersByTime(299_000)
    expect(core.getDevtoolsSnapshot().queries).toHaveLength(1)

    const releaseAgain = query.subscribe(noop)
    vi.advanceTimersByTime(300_000)
    expect(core.getDevtoolsSnapshot().queries).toHaveLength(1)
    releaseAgain()
    vi.advanceTimersByTime(300_000)

    expect(core.getDevtoolsSnapshot().queries).toEqual([])
    expect(query.getSnapshot().status).toBe('pending')
    expect(listener).toHaveBeenCalled()
    releaseDevtools()
  } finally {
    vi.useRealTimers()
  }
})

function pageResult<Item>(
  page: Item[],
  isDone: boolean,
  continueCursor: string
): PaginationResult<Item> {
  return { continueCursor, isDone, page }
}

type QueryDescriptor = Readonly<{
  args: Readonly<Record<string, unknown>>
  key: string
  path: string
}>

type Task = {
  _id: string
  label: string
  rank: number
}

type QueryListener = (result: SyncQueryResult) => void

type Subscription = {
  listener: QueryListener
  query: QueryDescriptor
  released: boolean
}

type MutationDescriptor = Readonly<{
  args: Readonly<Record<string, unknown>>
  path: string
}>

type PendingMutation = {
  mutation: MutationDescriptor
  promise: Promise<unknown>
  reject: (error: unknown) => void
  requestId: number
  resolve: (value: unknown) => void
}

type MutationTransitionListener = Readonly<{
  begin: (requestIds: readonly number[]) => void
  end: () => void
}>
