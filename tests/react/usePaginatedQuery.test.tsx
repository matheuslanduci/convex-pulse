import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  ConvexPulseReactClient,
  ConvexPulseReactProvider,
  useQuery
} from 'convex-pulse/react'
import type { PaginationOptions, PaginationResult } from 'convex/server'
import { makeFunctionReference } from 'convex/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { FakeWebSocket } from '#testkit/FakeWebSocket.js'

beforeEach(() => {
  FakeWebSocket.instances.length = 0
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('loads and concatenates paginated query pages through continuation cursors', async () => {
  const { client, socket } = setup()
  const view = renderPagination(client)
  await socket.connected()

  expect(screen.getByText('pending:')).toBeTruthy()
  expect(addModifications(socket)).toMatchObject([
    {
      args: [
        {
          channel: 'general',
          paginationOpts: { cursor: null, numItems: 2 }
        }
      ],
      udfPath: 'messages:list'
    }
  ])

  await socket.succeed(page(['one', 'two'], false, 'cursor-2'))
  expect(await screen.findByText('success: one, two')).toBeTruthy()
  expect(screen.getByText('can load more')).toBeTruthy()
  expect(screen.getByText('not loading more')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
  expect(await screen.findByText('success: one, two')).toBeTruthy()
  expect(screen.getByText('loading')).toBeTruthy()
  expect(screen.getByText('loading more')).toBeTruthy()
  expect(addModifications(socket)).toHaveLength(2)
  expect(addModifications(socket)[1]).toMatchObject({
    args: [
      {
        channel: 'general',
        paginationOpts: { cursor: 'cursor-2', numItems: 3 }
      }
    ],
    udfPath: 'messages:list'
  })

  await socket.succeed(page(['three'], true, 'cursor-3'), 1)
  expect(await screen.findByText('success: one, two, three')).toBeTruthy()
  expect(screen.getByText('exhausted')).toBeTruthy()
  expect(screen.getByText('not loading more')).toBeTruthy()

  view.unmount()
  expect(removeModifications(socket)).toHaveLength(2)
})

it('resets pagination when query arguments change', async () => {
  const { client, socket } = setup()
  const view = renderPagination(client)
  await socket.succeed(page(['one'], false, 'cursor-1'))
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
  await socket.succeed(page(['two'], true, 'cursor-2'), 1)
  expect(await screen.findByText('success: one, two')).toBeTruthy()

  view.rerender(
    <ConvexPulseReactProvider convex={client}>
      <PaginationView channel="random" />
    </ConvexPulseReactProvider>
  )

  expect(await screen.findByText('pending:')).toBeTruthy()
  expect(addModifications(socket).at(-1)).toMatchObject({
    args: [
      {
        channel: 'random',
        paginationOpts: { cursor: null, numItems: 2 }
      }
    ]
  })
})

it('surfaces a paginated query error and retains earlier page results', async () => {
  const { client, socket } = setup()
  renderPagination(client)
  await socket.succeed(page(['one'], false, 'cursor-1'))
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

  await socket.fail('Pagination failed', 1)

  expect(await screen.findByText('error:')).toBeTruthy()
  expect(screen.getByText('not loading more')).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toBe('Pagination failed')
})

it('resets the pagination session after an invalid cursor error', async () => {
  const { client, socket } = setup()
  renderPagination(client)

  await socket.fail('InvalidCursor: query changed')

  expect(await screen.findByText('pending:')).toBeTruthy()
  expect(screen.getByText('not loading more')).toBeTruthy()
  expect(addModifications(socket)).toHaveLength(2)
  expect(removeModifications(socket)).toHaveLength(1)

  await socket.succeed(page(['fresh'], true, 'fresh-cursor'), 1)
  expect(await screen.findByText('success: fresh')).toBeTruthy()
})

it('replaces a server-requested page split without showing duplicates', async () => {
  const { client, socket } = setup()
  renderPagination(client)

  await socket.succeed({
    ...page(['one', 'two', 'three'], false, 'cursor-3'),
    pageStatus: 'SplitRecommended',
    splitCursor: 'cursor-1'
  })

  expect(await screen.findByText('success: one, two, three')).toBeTruthy()
  expect(addModifications(socket)).toHaveLength(3)
  expect(addModifications(socket)[1]).toMatchObject({
    args: [
      {
        paginationOpts: { cursor: null, endCursor: 'cursor-1' }
      }
    ]
  })
  expect(addModifications(socket)[2]).toMatchObject({
    args: [
      {
        paginationOpts: { cursor: 'cursor-1', endCursor: 'cursor-3' }
      }
    ]
  })

  await socket.succeed(page(['one'], false, 'cursor-1'), 1)
  await socket.succeed(page(['two', 'three'], false, 'cursor-3'), 2)

  expect(await screen.findByText('success: one, two, three')).toBeTruthy()
  expect(removeModifications(socket)).toHaveLength(1)
})

it('does not subscribe when a paginated query is skipped', async () => {
  const { client, socket } = setup()

  render(
    <ConvexPulseReactProvider convex={client}>
      <SkippedPaginationView />
    </ConvexPulseReactProvider>
  )
  await socket.connected()

  expect(screen.getByText('disabled:')).toBeTruthy()
  expect(addModifications(socket)).toHaveLength(0)
})

it('rejects a negative initial page size', () => {
  const { client } = setup()
  expect(() =>
    render(
      <ConvexPulseReactProvider convex={client}>
        <InvalidPaginationView />
      </ConvexPulseReactProvider>
    )
  ).toThrow('initialNumItems must be a non-negative number')
})

function PaginationView({ channel }: Readonly<{ channel: string }>) {
  const pagination = useQuery(messages, {
    args: { channel },
    pagination: { initialNumItems: 2 }
  })

  return (
    <section>
      <p>
        {pagination.status}: {pagination.data?.join(', ')}
      </p>
      <p>{pagination.isLoading ? 'loading' : 'loaded'}</p>
      <p>{pagination.isLoadingMore ? 'loading more' : 'not loading more'}</p>
      <p>{pagination.canLoadMore ? 'can load more' : 'exhausted'}</p>
      {pagination.error !== null && (
        <p role="alert">{pagination.error.message}</p>
      )}
      <button type="button" onClick={() => pagination.loadMore(3)}>
        Load more
      </button>
    </section>
  )
}

function SkippedPaginationView() {
  const pagination = useQuery(messages, {
    args: 'skip',
    pagination: { initialNumItems: 2 }
  })

  return (
    <p>
      {pagination.status}: {pagination.data?.join(', ')}
    </p>
  )
}

function InvalidPaginationView() {
  useQuery(messages, {
    args: { channel: 'general' },
    pagination: { initialNumItems: -1 }
  })
  return null
}

function setup() {
  const client = new ConvexPulseReactClient('https://example.convex.cloud')
  const [socket] = FakeWebSocket.instances
  if (!socket) {
    throw new Error('Expected the client to create a WebSocket')
  }
  return { client, socket }
}

function renderPagination(client: ConvexPulseReactClient) {
  return render(
    <ConvexPulseReactProvider convex={client}>
      <PaginationView channel="general" />
    </ConvexPulseReactProvider>
  )
}

function page(
  values: string[],
  isDone: boolean,
  continueCursor: string
): PaginationResult<string> {
  return { continueCursor, isDone, page: values }
}

function addModifications(socket: FakeWebSocket) {
  return modifications(socket, 'Add')
}

function removeModifications(socket: FakeWebSocket) {
  return modifications(socket, 'Remove')
}

function modifications(socket: FakeWebSocket, type: 'Add' | 'Remove') {
  return socket
    .querySetFrames()
    .flatMap((frame) => frame.modifications as Record<string, unknown>[])
    .filter((modification) => modification.type === type)
}

const messages = makeFunctionReference<
  'query',
  { channel: string; paginationOpts: PaginationOptions },
  PaginationResult<string>
>('messages:list')
