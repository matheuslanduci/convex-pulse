import { ConvexPulseClient } from 'convex-pulse'
import type { OptimisticQuery } from 'convex-pulse'
import { makeFunctionReference } from 'convex/server'
import { afterEach, beforeEach, expect, expectTypeOf, it, vi } from 'vitest'

import { FakeWebSocket } from '#testkit/FakeWebSocket.js'

beforeEach(() => {
  FakeWebSocket.instances.length = 0
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

it('publishes optimistic appends to onUpdate and preserves them across live updates', async () => {
  const { client, socket } = setup()
  const valueList: string[][] = []
  const release = client.onUpdate(tasks, { args: {} }, (value) => {
    valueList.push(value)
  })
  await socket.succeed(['Buy milk'])
  await vi.waitFor(() => expect(valueList).toEqual([['Buy milk']]))

  const mutation = client.mutation(addTask, {
    args: { value: 'Call mom' },
    optimistic: ({ data, store }) => store.get(tasks).append(data.value)
  })

  expect(valueList.at(-1)).toEqual(['Buy milk', 'Call mom'])
  await socket.succeed(['Buy milk', 'Pay rent'])
  expect(valueList.at(-1)).toEqual(['Buy milk', 'Pay rent', 'Call mom'])

  await socket.resolveMutation('Call mom', ['Buy milk', 'Pay rent', 'Call mom'])
  await expect(mutation).resolves.toBe('Call mom')
  expect(valueList.at(-1)).toEqual(['Buy milk', 'Pay rent', 'Call mom'])
  expect(valueList).toEqual([
    ['Buy milk'],
    ['Buy milk', 'Call mom'],
    ['Buy milk', 'Pay rent', 'Call mom'],
    ['Buy milk', 'Pay rent', 'Call mom']
  ])

  release()
  await client.close()
})

it('rolls back an optimistic append when the mutation fails', async () => {
  const { client, socket } = setup()
  const valueList: string[][] = []
  const release = client.onUpdate(tasks, { args: {} }, (value) => {
    valueList.push(value)
  })
  await socket.succeed(['Buy milk'])
  await vi.waitFor(() => expect(valueList).toHaveLength(1))

  const mutation = client.mutation(addTask, {
    args: { value: 'Call mom' },
    optimistic: ({ data, store }) => store.get(tasks).append(data.value)
  })
  expect(valueList.at(-1)).toEqual(['Buy milk', 'Call mom'])

  await socket.rejectMutation('Not allowed')

  await expect(mutation).rejects.toThrow('Not allowed')
  expect(valueList.at(-1)).toEqual(['Buy milk'])

  release()
  await client.close()
})

it('keeps overlapping optimistic layers when mutations settle out of order', async () => {
  const { client, socket } = setup()
  const valueList: string[][] = []
  const release = client.onUpdate(tasks, { args: {} }, (value) => {
    valueList.push(value)
  })
  await socket.succeed([])
  await vi.waitFor(() => expect(valueList).toHaveLength(1))

  const first = optimisticAdd(client, 'First')
  const second = optimisticAdd(client, 'Second')
  expect(valueList.at(-1)).toEqual(['First', 'Second'])

  await socket.resolveMutation('Second', undefined, 1)
  await expect(second).resolves.toBe('Second')
  expect(valueList.at(-1)).toEqual(['First'])

  await socket.resolveMutation('First', ['First', 'Second'], 0)
  await expect(first).resolves.toBe('First')
  expect(valueList.at(-1)).toEqual(['First', 'Second'])

  release()
  await client.close()
})

it('publishes optimistic appends to watchQuery iterators', async () => {
  const { client, socket } = setup()
  const stream = client.watchQuery(tasks, { args: {} })
  const iterator = stream[Symbol.asyncIterator]()
  await socket.succeed([])
  await expect(iterator.next()).resolves.toEqual({ done: false, value: [] })

  const mutation = optimisticAdd(client, 'Call mom')

  await expect(iterator.next()).resolves.toEqual({
    done: false,
    value: ['Call mom']
  })

  await socket.resolveMutation('Call mom', ['Call mom'])
  await mutation
  await iterator.return?.()
  await client.close()
})

it('modifies primitive query values optimistically and rolls them back', async () => {
  const { client, socket } = setup()
  const valueList: string[] = []
  const release = client.onUpdate(status, { args: {} }, (value) => {
    valueList.push(value)
  })
  await socket.succeed('idle')
  await vi.waitFor(() => expect(valueList).toEqual(['idle']))

  const mutation = client.mutation(setStatus, {
    args: { value: 'saving' },
    optimistic: ({ data, store }) => store.get(status).modify(data.value)
  })
  expect(valueList.at(-1)).toBe('saving')

  await socket.succeed('server-update')
  expect(valueList.at(-1)).toBe('saving')

  await socket.rejectMutation('Not allowed')
  await expect(mutation).rejects.toThrow('Not allowed')
  expect(valueList.at(-1)).toBe('server-update')

  release()
  await client.close()
})

it('merges object query values optimistically across live updates', async () => {
  const { client, socket } = setup()
  const valueList: { count: number; label: string }[] = []
  const release = client.onUpdate(summary, { args: {} }, (value) => {
    valueList.push(value)
  })
  await socket.succeed({ count: 1, label: 'server' })
  await vi.waitFor(() => expect(valueList).toHaveLength(1))

  const mutation = client.mutation(setLabel, {
    args: { label: 'optimistic' },
    optimistic: ({ data, store }) =>
      store.get(summary).merge({ label: data.label })
  })
  expect(valueList.at(-1)).toEqual({ count: 1, label: 'optimistic' })

  await socket.succeed({ count: 2, label: 'deployment' })
  expect(valueList.at(-1)).toEqual({ count: 2, label: 'optimistic' })

  await socket.resolveMutation('optimistic', {
    count: 2,
    label: 'optimistic'
  })
  await expect(mutation).resolves.toBe('optimistic')
  expect(valueList.at(-1)).toEqual({ count: 2, label: 'optimistic' })

  release()
  await client.close()
})

it('exposes optimistic operations only for their matching result shape', () => {
  type ArrayOperations = OptimisticQuery<string[]>
  type ObjectOperations = OptimisticQuery<{
    count: number
  }>
  type PrimitiveOperations = OptimisticQuery<string>

  expectTypeOf<ArrayOperations>().toHaveProperty('append')
  expectTypeOf<ArrayOperations>().toHaveProperty('insert')
  expectTypeOf<ArrayOperations>().toHaveProperty('prepend')
  expectTypeOf<ArrayOperations>().toHaveProperty('remove')
  expectTypeOf<ArrayOperations>().toHaveProperty('replace')
  expectTypeOf<ArrayOperations>().toHaveProperty('update')
  expectTypeOf<ArrayOperations>().toHaveProperty('upsert')
  expectTypeOf<ArrayOperations>().not.toHaveProperty('merge')
  expectTypeOf<ArrayOperations>().not.toHaveProperty('modify')
  expectTypeOf<ObjectOperations>().toHaveProperty('merge')
  expectTypeOf<ObjectOperations>().not.toHaveProperty('append')
  expectTypeOf<ObjectOperations>().not.toHaveProperty('modify')
  expectTypeOf<PrimitiveOperations>().toHaveProperty('modify')
  expectTypeOf<PrimitiveOperations>().not.toHaveProperty('append')
  expectTypeOf<PrimitiveOperations>().not.toHaveProperty('merge')
})

it('deduplicates equivalent pending mutations and shares their result', async () => {
  const { client, socket } = setup()
  const first = deduplicatedRemove(client, 'task-id')
  const second = deduplicatedRemove(client, 'task-id')
  await socket.connected()

  expect(socket.mutationFrames()).toHaveLength(1)
  expect(second).toBe(first)

  await socket.resolveMutation(null)
  await expect(Promise.all([first, second])).resolves.toEqual([null, null])
  await client.close()
})

it('does not deduplicate distinct keys or mutation paths', async () => {
  const { client, socket } = setup()

  void deduplicatedRemove(client, 'first')
  void deduplicatedRemove(client, 'second')
  void client.mutation(removeOtherTask, {
    args: { id: 'first' },
    dedupe: ({ args }) => args.id
  })
  await socket.connected()

  expect(socket.mutationFrames()).toHaveLength(3)
  await client.close()
})

it('releases a dedupe key after success and failure', async () => {
  const { client, socket } = setup()
  const successful = deduplicatedRemove(client, 'task-id')
  await socket.resolveMutation(null)
  await successful

  const failed = deduplicatedRemove(client, 'task-id')
  await socket.rejectMutation('Not allowed')
  await expect(failed).rejects.toThrow('Not allowed')

  const retry = deduplicatedRemove(client, 'task-id')
  await socket.connected()
  expect(socket.mutationFrames()).toHaveLength(3)
  await socket.resolveMutation(null)
  await retry
  await client.close()
})

function setup() {
  const client = new ConvexPulseClient('https://example.convex.cloud')
  const [socket] = FakeWebSocket.instances

  if (!socket) {
    throw new Error('Expected the client to create a WebSocket')
  }

  return { client, socket }
}

function optimisticAdd(client: ConvexPulseClient, value: string) {
  return client.mutation(addTask, {
    args: { value },
    optimistic: ({ data, store }) => store.get(tasks).append(data.value)
  })
}

function deduplicatedRemove(client: ConvexPulseClient, id: string) {
  return client.mutation(removeTask, {
    args: { id },
    dedupe: ({ args }) => args.id
  })
}

const tasks = makeFunctionReference<'query', Record<string, never>, string[]>(
  'tasks:list'
)
const addTask = makeFunctionReference<'mutation', { value: string }, string>(
  'tasks:add'
)
const removeTask = makeFunctionReference<'mutation', { id: string }, null>(
  'tasks:remove'
)
const removeOtherTask = makeFunctionReference<'mutation', { id: string }, null>(
  'otherTasks:remove'
)
const status = makeFunctionReference<'query', Record<string, never>, string>(
  'status:get'
)
const setStatus = makeFunctionReference<'mutation', { value: string }, string>(
  'status:set'
)
const summary = makeFunctionReference<
  'query',
  Record<string, never>,
  { count: number; label: string }
>('summary:get')
const setLabel = makeFunctionReference<'mutation', { label: string }, string>(
  'summary:setLabel'
)
