import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createPreloadedQuery } from 'convex-pulse/http'
import type { PreloadedQuery } from 'convex-pulse/http'
import {
  ConvexPulseDevtools,
  ConvexPulseReactClient,
  ConvexPulseReactProvider,
  useConvexPulseAuth,
  useAction,
  useMutation,
  usePrefetchQuery,
  usePreloadedQuery,
  useQuery
} from 'convex-pulse/react'
import { makeFunctionReference } from 'convex/server'
import { useState } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { encodeConvexValue } from '#client/valueCodec.js'
import { FakeWebSocket } from '#testkit/FakeWebSocket.js'

beforeEach(() => {
  FakeWebSocket.instances.length = 0
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('keeps the shared framework client out of the React runtime exports', async () => {
  const publicApi = await import('convex-pulse/react')

  expect(Object.keys(publicApi).toSorted()).toEqual([
    'ConvexPulseDevtools',
    'ConvexPulseReactClient',
    'ConvexPulseReactProvider',
    'skipToken',
    'useAction',
    'useConvexPulseAuth',
    'useMutation',
    'useOnDataChange',
    'usePrefetchQuery',
    'usePreloadedQuery',
    'useQuery'
  ])
})

it('renders preloaded data immediately and replaces it with the live result', async () => {
  const { client, socket } = setup()
  const preloaded = createPreloadedQuery(tasks, {}, ['from server'])

  renderWithClient(client, <PreloadedView preloaded={preloaded} />)

  expect(screen.getByText('from server')).toBeTruthy()
  await socket.succeed(['live value'])
  expect(await screen.findByText('live value')).toBeTruthy()

  await client.close()
})

it('renders preloaded data on the server without constructing a WebSocket', () => {
  vi.unstubAllGlobals()
  const client = new ConvexPulseReactClient('https://example.convex.cloud')
  const preloaded = createPreloadedQuery(tasks, {}, ['server rendered'])

  const html = renderToString(
    <ConvexPulseReactProvider convex={client}>
      <PreloadedView preloaded={preloaded} />
    </ConvexPulseReactProvider>
  )

  expect(html).toContain('server rendered')
})
it('forwards React query and mutation retry options', async () => {
  const { client, socket } = setup()
  renderWithClient(client, <RetryView />)

  await socket.fail('first')
  expect(screen.getByText('pending')).toBeTruthy()
  await socket.succeed(['ready'], 1)
  expect(await screen.findByText('ready')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Retry mutation' }))
  await socket.rejectMutation('first')
  await vi.waitFor(() => expect(socket.mutationFrames()).toHaveLength(2))
  await socket.resolveMutation('done')
  expect(await screen.findByText('done')).toBeTruthy()

  await client.close()
})

it('executes encoded actions and exposes their lifecycle to devtools', async () => {
  const { client, socket } = setup()
  const action = client.action(echoAction, { value: Number.POSITIVE_INFINITY })
  await socket.connected()

  expect(socket.actionFrames()).toEqual([
    expect.objectContaining({
      args: [encodeConvexValue({ value: Number.POSITIVE_INFINITY })],
      udfPath: 'values:echo'
    })
  ])
  expect(client.devtools.getSnapshot().actions).toEqual([
    expect.objectContaining({ phase: 'sent' })
  ])

  await socket.resolveAction('done')
  await expect(action).resolves.toBe('done')
  expect(client.devtools.getSnapshot().actions).toEqual([
    expect.objectContaining({ phase: 'success', result: 'done' })
  ])
})

it('deduplicates concurrent React actions with the configured value', async () => {
  const { client, socket } = setup()
  renderWithClient(client, <ActionDedupeView />)

  fireEvent.click(screen.getByRole('button', { name: 'Run actions' }))
  await socket.connected()
  expect(socket.actionFrames()).toHaveLength(1)

  await socket.resolveAction('shared')
  expect(await screen.findByText('shared, shared')).toBeTruthy()

  await client.close()
})

it('mounts and unmounts the React devtools component with its provider', () => {
  const { client } = setup()
  const view = render(
    <ConvexPulseReactProvider convex={client}>
      <ConvexPulseDevtools initialIsOpen position="top-left" />
    </ConvexPulseReactProvider>
  )

  expect(document.querySelector('[data-convex-pulse-devtools]')).toBeTruthy()
  expect(
    document.querySelector<HTMLElement>('[data-convex-pulse-devtools]')?.dataset
      .position
  ).toBe('top-left')

  view.unmount()
  expect(document.querySelector('[data-convex-pulse-devtools]')).toBeNull()
})

it('preserves an optimistic append when a live update arrives', async () => {
  const { client, socket } = setup()
  const handle = client.prepareQuery(tasks, {})
  const valueList: string[][] = []
  const release = handle.subscribe(() => {
    const snapshot = handle.getSnapshot()
    if (snapshot.status === 'success') {
      valueList.push(snapshot.data)
    }
  })
  renderWithClient(client, <OptimisticView />)
  socket.succeed(['Buy milk'])
  await screen.findByText('Buy milk')

  fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
  expect(screen.getByText('Buy milk, Call mom')).toBeTruthy()

  socket.succeed(['Buy milk', 'Pay rent'])
  expect(await screen.findByText('Buy milk, Pay rent, Call mom')).toBeTruthy()

  await socket.resolveMutation('Call mom', ['Buy milk', 'Pay rent', 'Call mom'])
  expect(await screen.findByText('Buy milk, Pay rent, Call mom')).toBeTruthy()
  expect(valueList).toEqual([
    ['Buy milk'],
    ['Buy milk', 'Call mom'],
    ['Buy milk', 'Pay rent', 'Call mom'],
    ['Buy milk', 'Pay rent', 'Call mom']
  ])
  release()
})

it('rolls back an optimistic append when its mutation fails', async () => {
  const { client, socket } = setup()
  renderWithClient(client, <OptimisticView />)
  await socket.succeed(['Buy milk'])
  await screen.findByText('Buy milk')

  fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
  expect(screen.getByText('Buy milk, Call mom')).toBeTruthy()

  await socket.rejectMutation('Not allowed')

  expect(await screen.findByText('Buy milk')).toBeTruthy()
})

it('keeps overlapping optimistic layers when mutations settle out of order', async () => {
  const { client, socket } = setup()
  renderWithClient(client, <OptimisticView />)
  await socket.succeed([])
  await vi.waitFor(() => {
    expect(
      screen.getByRole('button', { name: 'Add task' }).previousElementSibling
        ?.textContent
    ).toBe('')
  })

  let first!: Promise<string>
  let second!: Promise<string>
  act(() => {
    first = optimisticAdd(client, 'First')
    second = optimisticAdd(client, 'Second')
  })
  expect(screen.getByText('First, Second')).toBeTruthy()

  await socket.resolveMutation('Second', undefined, 1)
  await second
  expect(await screen.findByText('First')).toBeTruthy()

  await socket.resolveMutation('First', ['First', 'Second'], 0)
  await first
  expect(await screen.findByText('First, Second')).toBeTruthy()
})

it('modifies primitive React query values optimistically', async () => {
  const { client, socket } = setup()
  const handle = client.prepareQuery(status, {})
  const release = handle.subscribe(vi.fn())
  await socket.succeed('idle')
  await vi.waitFor(() => expect(handle.getSnapshot().data).toBe('idle'))

  const mutation = client.mutation(
    setStatus,
    { value: 'saving' },
    undefined,
    ({ data, store }) => store.get(status).modify(data.value)
  )
  expect(handle.getSnapshot().data).toBe('saving')

  await socket.succeed('server-update')
  expect(handle.getSnapshot().data).toBe('saving')

  await socket.rejectMutation('Not allowed')
  await expect(mutation).rejects.toThrow('Not allowed')
  expect(handle.getSnapshot().data).toBe('server-update')

  release()
  await client.close()
})

it('merges object React query values optimistically', async () => {
  const { client, socket } = setup()
  const handle = client.prepareQuery(summary, {})
  const release = handle.subscribe(vi.fn())
  await socket.succeed({ count: 1, label: 'server' })
  await vi.waitFor(() =>
    expect(handle.getSnapshot().data).toEqual({ count: 1, label: 'server' })
  )

  const mutation = client.mutation(
    setLabel,
    { label: 'optimistic' },
    undefined,
    ({ data, store }) => store.get(summary).merge({ label: data.label })
  )
  expect(handle.getSnapshot().data).toEqual({
    count: 1,
    label: 'optimistic'
  })

  await socket.succeed({ count: 2, label: 'deployment' })
  expect(handle.getSnapshot().data).toEqual({
    count: 2,
    label: 'optimistic'
  })

  await socket.resolveMutation('optimistic', {
    count: 2,
    label: 'optimistic'
  })
  await mutation
  expect(handle.getSnapshot().data).toEqual({
    count: 2,
    label: 'optimistic'
  })

  release()
  await client.close()
})

it('applies one optimistic layer to multiple query entries', async () => {
  const { client, socket } = setup()
  const tasksHandle = client.prepareQuery(tasks, {})
  const statusHandle = client.prepareQuery(status, {})
  const releaseTasks = tasksHandle.subscribe(vi.fn())
  const releaseStatus = statusHandle.subscribe(vi.fn())
  await socket.succeed(['Buy milk'])

  const mutation = client.mutation(
    setTask,
    { value: 'Call mom' },
    undefined,
    ({ data, store }) => {
      store.get(tasks).append(data.value)
      store.get(status).modify('saving')
    }
  )

  expect(tasksHandle.getSnapshot().data).toEqual(['Buy milk', 'Call mom'])
  expect(statusHandle.getSnapshot().status).toBe('pending')
  await socket.resolveMutation('Call mom')
  await mutation
  releaseTasks()
  releaseStatus()
})

it('leaves incompatible values unchanged during optimistic updates', async () => {
  const { client, socket } = setup()
  const handle = client.prepareQuery(tasks, {})
  const release = handle.subscribe(vi.fn())
  await socket.succeed('not-an-array')

  const mutation = client.mutation(
    setTask,
    { value: 'Call mom' },
    undefined,
    ({ data, store }) => store.get(tasks).append(data.value)
  )

  expect(handle.getSnapshot().data).toBe('not-an-array')
  await socket.resolveMutation('Call mom')
  await mutation
  release()
})

it('settles optimistic mutations after their query entries are closed', async () => {
  const { client, socket } = setup()
  const handle = client.prepareQuery(tasks, {})
  handle.subscribe(vi.fn())
  await socket.succeed([])
  const mutation = client.mutation(
    setTask,
    { value: 'Call mom' },
    undefined,
    ({ data, store }) => store.get(tasks).append(data.value)
  )

  await client.close()
  await expect(mutation).rejects.toThrow()
})

it('deduplicates equivalent pending mutations', async () => {
  const { client, socket } = setup()
  renderWithClient(client, <DedupeView />)
  await socket.connected()

  fireEvent.click(screen.getByRole('button', { name: 'Delete twice' }))

  expect(socket.mutationFrames()).toHaveLength(1)
  await socket.resolveMutation(null)
})

it('shares deduplicated results and releases keys after settlement', async () => {
  const { client, socket } = setup()
  const first = client.mutation(removeTask, { id: 'task-id' }, 'task-id')
  const second = client.mutation(removeTask, { id: 'task-id' }, 'task-id')
  await socket.connected()

  expect(second).toBe(first)
  expect(socket.mutationFrames()).toHaveLength(1)
  await socket.resolveMutation(null)
  await expect(Promise.all([first, second])).resolves.toEqual([null, null])

  const failed = client.mutation(removeTask, { id: 'task-id' }, 'task-id')
  await socket.rejectMutation('Not allowed')
  await expect(failed).rejects.toThrow('Not allowed')

  const retry = client.mutation(removeTask, { id: 'task-id' }, 'task-id')
  expect(socket.mutationFrames()).toHaveLength(3)
  await socket.resolveMutation(null)
  await retry
})

it('does not deduplicate different keys or mutation paths', async () => {
  const { client, socket } = setup()

  void client.mutation(removeTask, { id: 'first' }, 'first')
  void client.mutation(removeTask, { id: 'second' }, 'second')
  void client.mutation(removeOtherTask, { id: 'first' }, 'first')
  await socket.connected()

  expect(socket.mutationFrames()).toHaveLength(3)
})

it('cancels a running prefetch and removes its subscription', async () => {
  const { client, socket } = setup()
  renderWithClient(client, <PrefetchView />)
  await socket.connected()

  fireEvent.click(screen.getByRole('button', { name: 'Cancel prefetch' }))

  expect(await screen.findByText(/AbortError/u)).toBeTruthy()
  expect(socket.removeFrames()).toHaveLength(1)
})

it('resolves a successful prefetch and releases its subscription', async () => {
  const { client, socket } = setup()
  const handle = client.prefetch(tasks, {})

  await socket.succeed(['Buy milk'])

  await expect(handle.ready).resolves.toEqual(['Buy milk'])
  expect(socket.removeFrames()).toHaveLength(1)
  handle.cancel()
  handle.cancel()
  expect(socket.removeFrames()).toHaveLength(1)
})

it('rejects a failed prefetch and releases its subscription', async () => {
  const { client, socket } = setup()
  const handle = client.prefetch(tasks, {})

  await socket.fail('Not allowed')

  await expect(handle.ready).rejects.toThrow('Not allowed')
  expect(socket.removeFrames()).toHaveLength(1)
})

it('keeps a prefetch active while its query is pending', async () => {
  const { client, socket } = setup()
  const handle = client.prefetch(tasks, {})
  await socket.connected()

  client.setAuth(() => Promise.resolve('token'))
  await vi.waitFor(() => expect(socket.authenticateFrames()).toHaveLength(1))
  await socket.confirmAuth()

  expect(socket.removeFrames()).toHaveLength(0)
  await socket.succeed(['Authenticated'])
  await expect(handle.ready).resolves.toEqual(['Authenticated'])
})

it('shares a prefetch subscription with a mounted query', async () => {
  const { client, socket } = setup()
  renderWithClient(client, <OptimisticView />)
  const handle = client.prefetch(tasks, {})
  await socket.connected()

  expect(socket.querySetFrames()).toHaveLength(1)
  await socket.succeed([])
  await handle.ready
  expect(socket.removeFrames()).toHaveLength(0)
})

it('resets active queries on auth changes without resubscribing', async () => {
  const { client, socket } = setup()
  const authChangeList: boolean[] = []
  renderWithClient(client, <OptimisticView />)
  await socket.succeed(['Buy milk'])
  await screen.findByText('Buy milk')

  client.setAuth(() => Promise.resolve('token'), {
    onChange: (isAuthenticated) => authChangeList.push(isAuthenticated)
  })
  await vi.waitFor(() => expect(socket.authenticateFrames()).toHaveLength(1))
  await socket.confirmAuth()

  expect(authChangeList).toEqual([true])
  expect(await screen.findByText('pending')).toBeTruthy()
  expect(socket.removeFrames()).toHaveLength(0)
  expect(socket.querySetFrames()).toHaveLength(1)
  await socket.succeed(['Authenticated'])
  expect(await screen.findByText('Authenticated')).toBeTruthy()

  client.clearAuth()
  await vi.waitFor(() => expect(socket.authenticateFrames()).toHaveLength(2))
  await socket.confirmAuth()
  expect(authChangeList).toEqual([true, false])
  expect(await screen.findByText('pending')).toBeTruthy()
  expect(socket.removeFrames()).toHaveLength(0)
  expect(socket.querySetFrames()).toHaveLength(1)
  await socket.succeed(['Anonymous'])
  expect(await screen.findByText('Anonymous')).toBeTruthy()
})

it('fetches and clears auth through the React provider', async () => {
  const { client, socket } = setup()
  const getToken = vi.fn((_options: { skipCache: boolean }) =>
    Promise.resolve('provider-token')
  )
  function fetchToken({ forceRefreshToken }: { forceRefreshToken: boolean }) {
    return getToken({ skipCache: forceRefreshToken })
  }
  const view = render(
    <ConvexPulseReactProvider convex={client} fetchToken={fetchToken} />
  )

  await socket.connected()
  await vi.waitFor(() => expect(socket.authenticateFrames()).toHaveLength(1))

  expect(getToken).toHaveBeenCalledWith({ skipCache: false })
  expect(socket.authenticateFrames()[0]).toMatchObject({
    value: 'provider-token'
  })
  await socket.confirmAuth()

  view.unmount()
  await vi.waitFor(() => expect(socket.authenticateFrames()).toHaveLength(2))
  await client.close()
})

it('waits for authenticated query initialization before mounting children', async () => {
  const { client, socket } = setup()
  const fetchToken = vi.fn(() => Promise.resolve('provider-token'))

  const view = render(
    <ConvexPulseReactProvider
      authLoadingFallback="auth loading"
      convex={client}
      fetchToken={fetchToken}
    >
      <AuthQueryView />
    </ConvexPulseReactProvider>
  )

  expect(screen.getByText('auth loading')).toBeTruthy()
  expect(socket.querySetFrames()).toHaveLength(0)
  await socket.connected()
  await vi.waitFor(() => expect(socket.authenticateFrames()).toHaveLength(1))
  expect(socket.querySetFrames()).toHaveLength(0)

  await socket.confirmAuth()
  expect(await screen.findByText('authenticated: pending')).toBeTruthy()
  expect(socket.querySetFrames()).toHaveLength(1)

  await socket.succeed(['private'])
  expect(await screen.findByText('authenticated: private')).toBeTruthy()
  view.unmount()
  await client.close()
})

it('keeps descendants gated while the external auth provider is loading', async () => {
  const { client, socket } = setup()
  const fetchToken = vi.fn(() => Promise.resolve('provider-token'))
  const view = render(
    <ConvexPulseReactProvider
      convex={client}
      fetchToken={fetchToken}
      isAuthLoading
    >
      <AuthQueryView />
    </ConvexPulseReactProvider>
  )

  await socket.connected()
  expect(fetchToken).not.toHaveBeenCalled()
  expect(socket.querySetFrames()).toHaveLength(0)

  view.rerender(
    <ConvexPulseReactProvider convex={client} fetchToken={fetchToken}>
      <AuthQueryView />
    </ConvexPulseReactProvider>
  )
  await vi.waitFor(() => expect(socket.authenticateFrames()).toHaveLength(1))
  expect(socket.querySetFrames()).toHaveLength(0)

  await socket.confirmAuth()
  expect(await screen.findByText('authenticated: pending')).toBeTruthy()
  view.unmount()
  await client.close()
})

it('removes prepared queries without listeners on auth changes', async () => {
  const { client, socket } = setup()
  const inactive = client.prepareQuery(status, {})
  const active = client.prepareQuery(tasks, {})
  const release = active.subscribe(vi.fn())
  await socket.succeed(['Buy milk'])

  client.setAuth(() => Promise.resolve('token'))
  await vi.waitFor(() => expect(socket.authenticateFrames()).toHaveLength(1))
  await socket.confirmAuth()

  expect(inactive.getSnapshot().status).toBe('pending')
  release()
})

it('ignores repeated subscription releases', async () => {
  const { client, socket } = setup()
  const release = client.prepareQuery(tasks, {}).subscribe(vi.fn())
  await socket.connected()

  release()
  release()

  expect(socket.removeFrames()).toHaveLength(1)
})

it('uses empty arguments for mutations called without arguments', async () => {
  const { client, socket } = setup()
  renderWithClient(client, <NoArgsMutationView />)

  fireEvent.click(screen.getByRole('button', { name: 'Run mutation' }))
  await socket.connected()

  expect(socket.mutationFrames()[0]).toMatchObject({ args: [{}] })
  await socket.resolveMutation(null)
})

it('exposes observable React mutation state, callbacks, errors, and reset', async () => {
  const { client, socket } = setup()
  renderWithClient(client, <MutationStateView />)

  expect(screen.getByText('Mutation: idle, false, empty')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Save mutation' }))
  expect(screen.getByText('Mutation: pending, true, empty')).toBeTruthy()

  await socket.resolveMutation('saved')
  expect(
    await screen.findByText('Mutation: success, false, saved')
  ).toBeTruthy()
  expect(
    screen.getByText('mutate:done, success:saved, settled:success')
  ).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Reset mutation' }))
  expect(screen.getByText('Mutation: idle, false, empty')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Save mutation' }))
  await socket.rejectMutation('Not allowed')
  expect(
    await screen.findByText('Mutation: error, false, Not allowed')
  ).toBeTruthy()

  await client.close()
})

it('exposes observable React action state, callbacks, retries, and reset', async () => {
  const { client, socket } = setup()
  renderWithClient(client, <ActionStateView />)

  expect(screen.getByText('Action: idle, false, empty')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Run action' }))
  expect(screen.getByText('Action: pending, true, empty')).toBeTruthy()

  await socket.rejectAction('try again')
  await vi.waitFor(() => expect(socket.actionFrames()).toHaveLength(2))
  expect(screen.getByText('Action: pending, true, empty')).toBeTruthy()
  await socket.resolveAction('formatted')
  expect(
    await screen.findByText('Action: success, false, formatted')
  ).toBeTruthy()
  expect(screen.getByText('success:formatted')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Reset action' }))
  expect(screen.getByText('Action: idle, false, empty')).toBeTruthy()
  await client.close()
})

it('throws a useful error when a hook is rendered without a provider', () => {
  vi.spyOn(console, 'error').mockImplementation(noop)

  expect(() => render(<MissingProviderView />)).toThrow(
    'Convex Pulse hooks must be used inside a provider'
  )
})

it('closes the browser transport when the React client closes', async () => {
  const { client, socket } = setup()

  await client.close()

  expect(socket.readyState).toBe(3)
})

function OptimisticView() {
  const query = useQuery(tasks, { args: {} })
  const add = useMutation(setTask, {
    optimistic: ({ data, store }) => store.get(tasks).append(data.value)
  })

  return (
    <section>
      <p>{query.status === 'success' ? query.data.join(', ') : query.status}</p>
      <button
        type="button"
        onClick={() => void add({ value: 'Call mom' }).catch(noop)}
      >
        Add task
      </button>
    </section>
  )
}

function DedupeView() {
  const remove = useMutation(removeTask, {
    dedupe: ({ args }) => args.id
  })

  function removeTwice() {
    void remove({ id: 'task-id' })
    void remove({ id: 'task-id' })
  }

  return (
    <button type="button" onClick={removeTwice}>
      Delete twice
    </button>
  )
}

function PrefetchView() {
  const prefetch = usePrefetchQuery(tasks)
  const [result, setResult] = useState('pending')

  function cancelPrefetch() {
    const handle = prefetch()
    handle.cancel()
    void handle.ready.catch((error: unknown) => {
      setResult(error instanceof Error ? error.name : String(error))
    })
  }

  return (
    <section>
      <p>{result}</p>
      <button type="button" onClick={cancelPrefetch}>
        Cancel prefetch
      </button>
    </section>
  )
}

function MissingProviderView() {
  useQuery(tasks, { args: {} })
  return null
}

function RetryView() {
  const query = useQuery(tasks, { args: {}, retries: 1 })
  const mutate = useMutation(setTask, { retries: 1 })
  const [result, setResult] = useState('')

  function runMutation() {
    void mutate({ value: 'done' }).then(setResult)
  }

  return (
    <section>
      <p>{query.status === 'success' ? query.data.join(', ') : query.status}</p>
      <p>{result}</p>
      <button type="button" onClick={runMutation}>
        Retry mutation
      </button>
    </section>
  )
}

function NoArgsMutationView() {
  const run = useMutation(runTask)

  return (
    <button type="button" onClick={() => void run()}>
      Run mutation
    </button>
  )
}

function MutationStateView() {
  const [events, setEvents] = useState<string[]>([])
  const mutation = useMutation(setTask, {
    onError: ({ error }) =>
      setEvents((current) => [...current, `error:${error.message}`]),
    onMutate: ({ args }) =>
      setEvents((current) => [...current, `mutate:${args.value}`]),
    onSettled: ({ error }) =>
      setEvents((current) => [
        ...current,
        `settled:${error === null ? 'success' : 'error'}`
      ]),
    onSuccess: ({ data }) =>
      setEvents((current) => [...current, `success:${data}`])
  })
  const value = mutation.data ?? mutation.error?.message ?? 'empty'

  return (
    <section>
      <p>{`Mutation: ${mutation.status}, ${String(mutation.isPending)}, ${value}`}</p>
      <p>{events.join(', ')}</p>
      <button
        type="button"
        onClick={() => void mutation({ value: 'done' }).catch(noop)}
      >
        Save mutation
      </button>
      <button type="button" onClick={mutation.reset}>
        Reset mutation
      </button>
    </section>
  )
}

function ActionStateView() {
  const [event, setEvent] = useState('')
  const action = useAction(echoAction, {
    onSuccess: ({ data }) => setEvent(`success:${data}`),
    retries: 1
  })
  const value = action.data ?? action.error?.message ?? 'empty'

  return (
    <section>
      <p>{`Action: ${action.status}, ${String(action.isPending)}, ${value}`}</p>
      <p>{event}</p>
      <button
        type="button"
        onClick={() => void action({ value: 1 }).catch(noop)}
      >
        Run action
      </button>
      <button type="button" onClick={action.reset}>
        Reset action
      </button>
    </section>
  )
}

function PreloadedView({
  preloaded
}: Readonly<{ preloaded: PreloadedQuery<typeof tasks> }>) {
  const value = usePreloadedQuery(preloaded)
  useMutation(setTask)
  useAction(echoAction)
  return <p>{value.join(', ')}</p>
}

function ActionDedupeView() {
  const [result, setResult] = useState('idle')
  const action = useAction(echoAction, {
    dedupe: ({ args }) => args.value
  })

  async function run() {
    const values = await Promise.all([
      action({ value: 1 }),
      action({ value: 1 })
    ])
    setResult(values.join(', '))
  }

  return (
    <section>
      <p>{result}</p>
      <button type="button" onClick={() => void run()}>
        Run actions
      </button>
    </section>
  )
}

function AuthQueryView() {
  const auth = useConvexPulseAuth()
  const query = useQuery(tasks, { args: {} })
  const value =
    query.status === 'success' ? query.data.join(', ') : query.status

  return (
    <p>
      {auth.isAuthenticated ? 'authenticated' : 'anonymous'}: {value}
    </p>
  )
}

function noop() {}

function setup() {
  const client = new ConvexPulseReactClient('https://example.convex.cloud')
  const [socket] = FakeWebSocket.instances
  if (!socket) {
    throw new Error('Expected the client to create a WebSocket')
  }
  return { client, socket }
}

function renderWithClient(
  client: ConvexPulseReactClient,
  children: React.ReactNode
) {
  return render(
    <ConvexPulseReactProvider convex={client}>
      {children}
    </ConvexPulseReactProvider>
  )
}

function optimisticAdd(client: ConvexPulseReactClient, value: string) {
  return client.mutation(setTask, { value }, undefined, ({ data, store }) =>
    store.get(tasks).append(data.value)
  )
}

const tasks = makeFunctionReference<'query', Record<string, never>, string[]>(
  'tasks:list'
)
const setTask = makeFunctionReference<'mutation', { value: string }, string>(
  'tasks:set'
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
const echoAction = makeFunctionReference<'action', { value: number }, string>(
  'values:echo'
)
const runTask = makeFunctionReference<'mutation', Record<string, never>, null>(
  'tasks:run'
)
