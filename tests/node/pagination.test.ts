import { ConvexPulseClient } from 'convex-pulse'
import type { PaginationOptions, PaginationResult } from 'convex/server'
import { makeFunctionReference } from 'convex/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { FakeWebSocket } from '#testkit/FakeWebSocket.js'

beforeEach(() => {
  FakeWebSocket.instances.length = 0
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

it('loads paginated Node watchQuery results', async () => {
  const { client, socket } = setup()
  const stream = client.watchQuery(paginatedTasks, {
    args: {},
    pagination: { initialNumItems: 1 }
  })
  const iterator = stream[Symbol.asyncIterator]()
  const first = iterator.next()
  await socket.succeed(page(['one'], false, 'next'))
  const firstResult = await first
  expect(firstResult.value?.data).toEqual(['one'])

  firstResult.value?.loadMore(1)
  const second = iterator.next()
  await socket.succeed(page(['two'], true, 'done'), 1)
  const secondResult = await second
  expect(secondResult.value?.data).toEqual(['one', 'two'])

  await iterator.return?.()
  await client.close()
})

it('publishes paginated Node onUpdate snapshots', async () => {
  const { client, socket } = setup()
  const snapshots: string[][] = []
  const release = client.onUpdate(
    paginatedTasks,
    { args: {}, pagination: { initialNumItems: 1 } },
    (snapshot) => {
      snapshots.push(snapshot.data ?? [])
      if (snapshot.canLoadMore) {
        snapshot.loadMore(1)
      }
    }
  )

  await socket.succeed(page(['one'], false, 'next'))
  expect(release.getCurrentValue()?.data).toEqual(['one'])
  await socket.succeed(page(['two'], true, 'done'), 1)
  expect(snapshots).toEqual([['one'], ['one', 'two']])
  expect(release.getCurrentValue()?.data).toEqual(['one', 'two'])

  release.unsubscribe()
  await client.close()
})

it('publishes multi-page optimistic changes and rollback atomically', async () => {
  const { client, socket } = setup()
  const snapshots: string[][] = []
  let loadMore = noop
  const release = client.onUpdate(
    paginatedTasks,
    { args: {}, pagination: { initialNumItems: 1 } },
    (snapshot) => {
      snapshots.push(snapshot.data ?? [])
      loadMore = () => snapshot.loadMore(1)
    }
  )
  await socket.succeed(page(['one'], false, 'next'))
  loadMore()
  await socket.succeed(page(['two'], true, 'done'), 1)

  const mutation = client.mutation(changeTasks, {
    args: {},
    optimistic: ({ store }) => {
      const pages = store.paginated(paginatedTasks, {})
      pages.prepend('top')
      pages.update('two', 'updated')
      pages.appendIfLoaded('bottom')
    }
  })
  expect(snapshots).toEqual([
    ['one'],
    ['one', 'two'],
    ['top', 'one', 'updated', 'bottom']
  ])

  await socket.rejectMutation('Not allowed')
  await expect(mutation).rejects.toThrow('Not allowed')
  expect(snapshots).toEqual([
    ['one'],
    ['one', 'two'],
    ['top', 'one', 'updated', 'bottom'],
    ['one', 'two']
  ])

  release()
  await client.close()
})

it('restarts paginated state from the first page after auth changes', async () => {
  const { client, socket } = setup()
  const snapshots: string[][] = []
  let loadMore = noop
  const release = client.onUpdate(
    paginatedTasks,
    { args: {}, pagination: { initialNumItems: 1 } },
    (snapshot) => {
      snapshots.push(snapshot.data ?? [])
      loadMore = () => snapshot.loadMore(1)
    }
  )

  await socket.succeed(page(['private-one'], false, 'private-next'))
  loadMore()
  await socket.succeed(page(['private-two'], true, 'private-done'), 1)
  expect(snapshots.at(-1)).toEqual(['private-one', 'private-two'])

  client.setAuth(() => Promise.resolve('new-identity-token'))
  await vi.waitFor(() => expect(socket.authenticateFrames()).toHaveLength(1))
  await socket.confirmAuth()

  await socket.succeed(page(['new-one'], true, 'new-done'), 2)
  expect(snapshots.at(-1)).toEqual(['new-one'])
  expect(snapshots).not.toContainEqual([
    'private-one',
    'private-two',
    'new-one'
  ])

  release()
  await client.close()
})

function noop() {
  // The first page replaces this after it arrives.
}

function setup() {
  const client = new ConvexPulseClient('https://example.convex.cloud')
  const [socket] = FakeWebSocket.instances
  if (socket === undefined) {
    throw new Error('Expected a WebSocket')
  }
  return { client, socket }
}

function page(values: string[], isDone: boolean, continueCursor: string) {
  return { continueCursor, isDone, page: values }
}

const paginatedTasks = makeFunctionReference<
  'query',
  { paginationOpts: PaginationOptions },
  PaginationResult<string>
>('tasks:paginated')
const changeTasks = makeFunctionReference<
  'mutation',
  Record<string, never>,
  null
>('tasks:change')
