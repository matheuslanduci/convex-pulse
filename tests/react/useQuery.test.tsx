import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  ConvexPulseReactClient,
  ConvexPulseReactProvider,
  useOnDataChange,
  useQuery
} from 'convex-pulse/react'
import { makeFunctionReference } from 'convex/server'
import type { ReactNode } from 'react'
import { Component, useState } from 'react'
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

it('renders the pending query state before the first result arrives', () => {
  const { client } = setup()

  renderQuery(client)

  expect(screen.getByText('pending')).toBeTruthy()
  expect(screen.getByText('loading')).toBeTruthy()
})

it('subscribes only while a React query is enabled', async () => {
  const { client, socket } = setup()

  render(
    <ConvexPulseReactProvider convex={client}>
      <EnabledQueryView />
    </ConvexPulseReactProvider>
  )
  await socket.connected()

  expect(screen.getByText('disabled')).toBeTruthy()
  expect(countModifications(socket, 'Add')).toBe(0)

  fireEvent.click(screen.getByRole('button', { name: 'Enable query' }))
  await vi.waitFor(() => expect(countModifications(socket, 'Add')).toBe(1))
  expect(screen.getByText('pending')).toBeTruthy()

  await socket.succeed(['Buy milk'])
  expect(await screen.findByText('success')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Disable query' }))
  await vi.waitFor(() => expect(countModifications(socket, 'Remove')).toBe(1))
  expect(screen.getByText('disabled')).toBeTruthy()
})

it('renders the first successful query result', async () => {
  const { client, socket } = setup()
  renderQuery(client)

  socket.succeed(['Buy milk'])

  expect(await screen.findByText('success: Buy milk')).toBeTruthy()
  expect(screen.getByText('loaded')).toBeTruthy()
})

it('renders subsequent live query results', async () => {
  const { client, socket } = setup()
  renderQuery(client)
  socket.succeed(['Buy milk'])
  await screen.findByText('success: Buy milk')

  socket.succeed(['Buy milk', 'Walk dog'])

  expect(await screen.findByText('success: Buy milk, Walk dog')).toBeTruthy()
})

it('does not rerender when a selected query value is unchanged', async () => {
  const { client, socket } = setup()
  const rendered = vi.fn()

  render(
    <ConvexPulseReactProvider convex={client}>
      <SelectedQueryView rendered={rendered} />
    </ConvexPulseReactProvider>
  )
  socket.succeed(['Buy milk'])
  expect(await screen.findByText('selected: Buy milk')).toBeTruthy()
  const renderCount = rendered.mock.calls.length

  await socket.succeed(['Buy milk', 'done: Walk dog'])
  expect(rendered).toHaveBeenCalledTimes(renderCount)

  socket.succeed(['Buy milk', 'Walk dog'])
  expect(await screen.findByText('selected: Buy milk, Walk dog')).toBeTruthy()
  expect(rendered.mock.calls.length).toBeGreaterThan(renderCount)
})

it('notifies option and hook listeners only when selected data changes', async () => {
  const { client, socket } = setup()
  const optionListener = vi.fn()
  const firstHookListener = vi.fn()
  const secondHookListener = vi.fn()
  const view = render(
    <ConvexPulseReactProvider convex={client}>
      <DataChangeQueryView
        firstHookListener={firstHookListener}
        optionListener={optionListener}
        secondHookListener={secondHookListener}
      />
    </ConvexPulseReactProvider>
  )

  await socket.succeed(['Buy milk'])
  expect(await screen.findByText('selected changes: Buy milk')).toBeTruthy()
  expect(optionListener).not.toHaveBeenCalled()
  expect(firstHookListener).not.toHaveBeenCalled()
  expect(secondHookListener).not.toHaveBeenCalled()

  await socket.succeed(['Buy milk', 'done: Walk dog'])
  expect(optionListener).not.toHaveBeenCalled()
  expect(firstHookListener).not.toHaveBeenCalled()
  expect(secondHookListener).not.toHaveBeenCalled()

  await socket.succeed(['Buy milk', 'Walk dog'])
  const change = {
    next: ['Buy milk', 'Walk dog'],
    previous: ['Buy milk']
  }
  await vi.waitFor(() => expect(optionListener).toHaveBeenCalledWith(change))
  expect(firstHookListener).toHaveBeenCalledWith(change)
  expect(secondHookListener).toHaveBeenCalledWith(change)

  view.unmount()
  await socket.succeed(['Buy milk', 'Walk dog', 'Call mom'])
  expect(optionListener).toHaveBeenCalledTimes(1)
  expect(firstHookListener).toHaveBeenCalledTimes(1)
  expect(secondHookListener).toHaveBeenCalledTimes(1)
})

it('renders a query error without leaving the loading state active', async () => {
  const { client, socket } = setup()
  renderQuery(client)

  socket.fail('Not allowed')

  expect(await screen.findByText('error: Not allowed')).toBeTruthy()
  expect(screen.getByText('loaded')).toBeTruthy()
})

it('skips a query without requiring its arguments or preparing a handle', async () => {
  const { client, socket } = setup()

  render(
    <ConvexPulseReactProvider convex={client}>
      <SkippedRequiredArgsQueryView />
    </ConvexPulseReactProvider>
  )
  await socket.connected()

  expect(screen.getByText('disabled')).toBeTruthy()
  expect(client.devtools.getSnapshot().queries).toEqual([])
  expect(countModifications(socket, 'Add')).toBe(0)
})

it('throws query errors during render when throwOnError is true', async () => {
  const { client, socket } = setup()

  render(
    <QueryErrorBoundary>
      <ConvexPulseReactProvider convex={client}>
        <ThrowingQueryView />
      </ConvexPulseReactProvider>
    </QueryErrorBoundary>,
    { onCaughtError: vi.fn() }
  )

  await socket.fail('Not allowed')

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Not allowed')
})

it('shares one subscription between components using the same query', async () => {
  const { client, socket } = setup()

  render(
    <ConvexPulseReactProvider convex={client}>
      <QueryView label="first" />
      <QueryView label="second" />
    </ConvexPulseReactProvider>
  )
  await socket.connected()

  expect(socket.querySetFrames()).toHaveLength(1)
  expect(socket.querySetFrames()[0]).toMatchObject({
    modifications: [{ type: 'Add', udfPath: 'tasks:list' }]
  })
})

it('keeps a shared subscription until the final component unmounts', async () => {
  const { client, socket } = setup()
  const first = renderQuery(client)
  const second = renderQuery(client)
  await socket.connected()

  first.unmount()
  expect(socket.removeFrames()).toHaveLength(0)

  second.unmount()
  expect(socket.removeFrames()).toHaveLength(1)
})

it('creates distinct subscriptions for different query arguments', async () => {
  const { client, socket } = setup()

  render(
    <ConvexPulseReactProvider convex={client}>
      <ArgQueryView args={{ filter: 'first' }} />
      <ArgQueryView args={{ filter: 'second' }} />
    </ConvexPulseReactProvider>
  )
  await socket.connected()

  expect(countModifications(socket, 'Add')).toBe(2)
})

it('shares subscriptions for canonically equivalent query arguments', async () => {
  const { client, socket } = setup()
  const reorderedArgs = Object.fromEntries([
    ['order', 1],
    ['filter', 'same']
  ])

  render(
    <ConvexPulseReactProvider convex={client}>
      <ArgQueryView args={{ filter: 'same', order: 1 }} />
      <ArgQueryView args={reorderedArgs} />
    </ConvexPulseReactProvider>
  )
  await socket.connected()

  expect(countModifications(socket, 'Add')).toBe(1)
})

it('releases the previous subscription when query arguments change', async () => {
  const { client, socket } = setup()
  const view = render(
    <ConvexPulseReactProvider convex={client}>
      <ArgQueryView args={{ filter: 'first' }} />
    </ConvexPulseReactProvider>
  )
  await socket.connected()

  view.rerender(
    <ConvexPulseReactProvider convex={client}>
      <ArgQueryView args={{ filter: 'second' }} />
    </ConvexPulseReactProvider>
  )
  await vi.waitFor(() => expect(countModifications(socket, 'Add')).toBe(2))

  expect(countModifications(socket, 'Remove')).toBe(1)
})

it('moves subscriptions when the provider client changes', async () => {
  const { client: firstClient, socket: firstSocket } = setup()
  const secondClient = new ConvexPulseReactClient(
    'https://second.example.convex.cloud'
  )
  const [, secondSocket] = FakeWebSocket.instances
  if (!secondSocket) {
    throw new Error('Expected the second client to create a WebSocket')
  }
  const view = render(
    <ConvexPulseReactProvider convex={firstClient}>
      <QueryView label="query" />
    </ConvexPulseReactProvider>
  )
  await firstSocket.connected()

  view.rerender(
    <ConvexPulseReactProvider convex={secondClient}>
      <QueryView label="query" />
    </ConvexPulseReactProvider>
  )
  await secondSocket.connected()
  await vi.waitFor(() =>
    expect(countModifications(firstSocket, 'Remove')).toBe(1)
  )

  expect(countModifications(secondSocket, 'Add')).toBe(1)
})

it('resubscribes after every consumer has unmounted', async () => {
  const { client, socket } = setup()
  const first = renderQuery(client)
  await socket.connected()
  first.unmount()

  renderQuery(client)
  await vi.waitFor(() => expect(countModifications(socket, 'Add')).toBe(2))

  expect(countModifications(socket, 'Remove')).toBe(1)
})

function QueryView({ label }: QueryViewProps) {
  const query = useQuery(tasks, { args: {} })
  let content = 'pending'
  if (query.status === 'success') {
    content = `success: ${query.data.join(', ')}`
  } else if (query.status === 'error') {
    content = `error: ${query.error.message}`
  }

  return (
    <section aria-label={label}>
      <p>{content}</p>
      <p>{query.isLoading ? 'loading' : 'loaded'}</p>
    </section>
  )
}

function ArgQueryView({ args }: ArgQueryViewProps) {
  useQuery(tasksByFilter, { args })

  return null
}

function EnabledQueryView() {
  const [enabled, setEnabled] = useState(false)
  const query = useQuery(tasks, { args: {}, enabled })

  return (
    <section>
      <p>{query.status}</p>
      <button type="button" onClick={() => setEnabled((value) => !value)}>
        {enabled ? 'Disable query' : 'Enable query'}
      </button>
    </section>
  )
}

function SkippedRequiredArgsQueryView() {
  const query = useQuery(tasksById, { args: 'skip' })
  return <p>{query.status}</p>
}

function ThrowingQueryView() {
  const query = useQuery(tasks, { args: {}, throwOnError: true })
  return <p>{query.status}</p>
}

class QueryErrorBoundary extends Component<
  Readonly<{ children: ReactNode }>,
  Readonly<{ error: Error | null }>
> {
  state = { error: null } as Readonly<{ error: Error | null }>

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    return this.state.error === null ? (
      this.props.children
    ) : (
      <p role="alert">{this.state.error.message}</p>
    )
  }
}

function SelectedQueryView({ rendered }: SelectedQueryViewProps) {
  rendered()
  const query = useQuery(tasks, {
    args: {},
    select: (values) => values.filter((value) => !value.startsWith('done:'))
  })

  return (
    <p>
      {query.status === 'success'
        ? `selected: ${query.data.join(', ')}`
        : query.status}
    </p>
  )
}

function DataChangeQueryView({
  firstHookListener,
  optionListener,
  secondHookListener
}: DataChangeQueryViewProps) {
  const query = useQuery(tasks, {
    args: {},
    onDataChange: optionListener,
    select: (values) => values.filter((value) => !value.startsWith('done:'))
  })
  useOnDataChange(query, firstHookListener)
  useOnDataChange(query, secondHookListener)

  return (
    <p>
      selected changes:{' '}
      {query.status === 'success' ? query.data.join(', ') : query.status}
    </p>
  )
}

function setup() {
  const client = new ConvexPulseReactClient('https://example.convex.cloud')
  const [socket] = FakeWebSocket.instances
  if (!socket) {
    throw new Error('Expected the client to create a WebSocket')
  }
  return { client, socket }
}

function renderQuery(client: ConvexPulseReactClient) {
  return render(
    <ConvexPulseReactProvider convex={client}>
      <QueryView label="query" />
    </ConvexPulseReactProvider>
  )
}

function countModifications(socket: FakeWebSocket, type: 'Add' | 'Remove') {
  return socket
    .querySetFrames()
    .flatMap((frame) => frame.modifications as Record<string, unknown>[])
    .filter((modification) => modification.type === type).length
}

const tasks = makeFunctionReference<'query', Record<string, never>, string[]>(
  'tasks:list'
)
const tasksByFilter = makeFunctionReference<
  'query',
  Record<string, unknown>,
  string[]
>('tasks:listByFilter')
const tasksById = makeFunctionReference<'query', { id: string }, string[]>(
  'tasks:listById'
)

type QueryViewProps = {
  label: string
}

type ArgQueryViewProps = {
  args: Record<string, unknown>
}

type SelectedQueryViewProps = {
  rendered: () => void
}

type DataChangeQueryViewProps = {
  firstHookListener: DataChangeListener
  optionListener: DataChangeListener
  secondHookListener: DataChangeListener
}

type DataChangeListener = (change: {
  next: string[]
  previous: string[]
}) => void
