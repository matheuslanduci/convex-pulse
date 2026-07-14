import { ConvexError } from 'convex/values'
import { expect, it, vi } from 'vitest'

import type { StateModification, StateVersion } from '#client/protocol.js'
import {
  SyncClient,
  SyncClientClosedError,
  SyncProtocolError
} from '#client/SyncClient.js'
import { FakeTransport } from '#testkit/FakeTransport.js'

function setup() {
  const transport = new FakeTransport()
  const client = new SyncClient(transport, {
    now: () => 123,
    randomUuid: () => 'session-id'
  })
  return { client, transport }
}

function query() {
  return {
    args: { channel: 'general' },
    key: 'messages:list:{"channel":"general"}',
    path: 'messages:list'
  }
}

function otherQuery() {
  return {
    args: { channel: 'random' },
    key: 'messages:list:{"channel":"random"}',
    path: 'messages:list'
  }
}

function version(querySet: number, ts: bigint): StateVersion {
  return { identity: 0, querySet, ts }
}

function identityVersion(
  identity: number,
  querySet: number,
  ts: bigint
): StateVersion {
  return { identity, querySet, ts }
}

function transition(
  startVersion: StateVersion,
  endVersion: StateVersion,
  modifications: readonly StateModification[]
) {
  return {
    endVersion,
    modifications,
    startVersion,
    type: 'Transition' as const
  }
}

function updated(
  queryId: number,
  value: unknown,
  journal: string | null
): StateModification {
  return { journal, queryId, type: 'QueryUpdated', value }
}

function noop() {}

class FakeBeforeUnloadTarget {
  readonly listeners = new Set<(event: FakeBeforeUnloadEvent) => void>()

  addEventListener(
    _type: 'beforeunload',
    listener: (event: FakeBeforeUnloadEvent) => void
  ) {
    this.listeners.add(listener)
  }

  removeEventListener(
    _type: 'beforeunload',
    listener: (event: FakeBeforeUnloadEvent) => void
  ) {
    this.listeners.delete(listener)
  }

  dispatch() {
    const event: FakeBeforeUnloadEvent = {
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true
      },
      returnValue: false
    }
    for (const listener of this.listeners) {
      listener(event)
    }
    return event
  }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}
const zero = version(0, 0n)

it('sends Connect and Add when the first subscriber acquires a query', () => {
  const { client, transport } = setup()
  client.subscribe(query(), noop)
  transport.connect()

  expect(transport.frames).toEqual([
    {
      clientTs: 123,
      connectionCount: 0,
      lastCloseReason: null,
      sessionId: 'session-id',
      type: 'Connect'
    },
    {
      baseVersion: 0,
      modifications: [
        {
          args: [{ channel: 'general' }],
          journal: null,
          queryId: 0,
          type: 'Add',
          udfPath: 'messages:list'
        }
      ],
      newVersion: 1,
      type: 'ModifyQuerySet'
    }
  ])
})

it('shares one query ID between equivalent subscriptions', () => {
  const { client, transport } = setup()
  transport.connect()
  client.subscribe(query(), noop)
  client.subscribe(query(), noop)

  expect(
    transport.frames.filter((frame) => frame.type === 'ModifyQuerySet')
  ).toHaveLength(1)
})

it('publishes initial and subsequent query results to every subscriber', () => {
  const { client, transport } = setup()
  const first = vi.fn()
  const second = vi.fn()
  transport.connect()
  client.subscribe(query(), first)
  client.subscribe(query(), second)

  transport.receive(
    transition(zero, version(1, 1n), [updated(0, ['first'], 'journal-1')])
  )
  transport.receive(
    transition(version(1, 1n), version(1, 2n), [
      updated(0, ['second'], 'journal-2')
    ])
  )

  expect(first).toHaveBeenNthCalledWith(1, {
    status: 'success',
    value: ['first']
  })
  expect(first).toHaveBeenNthCalledWith(2, {
    status: 'success',
    value: ['second']
  })
  expect(second).toHaveBeenCalledTimes(2)
})

it('gives a late subscriber the current query result', async () => {
  const { client, transport } = setup()
  transport.connect()
  client.subscribe(query(), noop)
  transport.receive(
    transition(zero, version(1, 1n), [updated(0, 'current', null)])
  )
  const listener = vi.fn()

  client.subscribe(query(), listener)
  await Promise.resolve()

  expect(listener).toHaveBeenCalledWith({
    status: 'success',
    value: 'current'
  })
})

it('publishes query failures without closing the client', () => {
  const { client, transport } = setup()
  const listener = vi.fn()
  transport.connect()
  client.subscribe(query(), listener)
  transport.receive(
    transition(zero, version(1, 1n), [
      {
        errorData: { code: 'DENIED' },
        errorMessage: 'denied',
        journal: null,
        queryId: 0,
        type: 'QueryFailed'
      }
    ])
  )

  const result = listener.mock.calls[0]?.[0]
  expect(result).toMatchObject({
    error: {
      data: { code: 'DENIED' },
      message: 'denied',
      name: 'ConvexError'
    },
    status: 'error'
  })
  expect(result?.error).toBeInstanceOf(ConvexError)
  expect(() => client.subscribe(otherQuery(), noop)).not.toThrow()
})

it('sends Remove only when the final subscriber unsubscribes', () => {
  const { client, transport } = setup()
  transport.connect()
  const releaseFirst = client.subscribe(query(), noop)
  const releaseSecond = client.subscribe(query(), noop)

  releaseFirst()
  expect(transport.frames).toHaveLength(2)
  releaseSecond()
  releaseSecond()

  expect(transport.frames.at(-1)).toEqual({
    baseVersion: 1,
    modifications: [{ queryId: 0, type: 'Remove' }],
    newVersion: 2,
    type: 'ModifyQuerySet'
  })
})

it('does not publish updates for a draining query generation', () => {
  const { client, transport } = setup()
  const listener = vi.fn()
  transport.connect()
  const release = client.subscribe(query(), listener)
  transport.receive(
    transition(zero, version(1, 1n), [updated(0, 'initial', null)])
  )
  listener.mockClear()
  release()

  transport.receive(
    transition(version(1, 1n), version(2, 2n), [updated(0, 'late', null)])
  )

  expect(listener).not.toHaveBeenCalled()
})

it('does not let an old QueryRemoved erase a remounted query', () => {
  const { client, transport } = setup()
  const current = vi.fn()
  transport.connect()
  const release = client.subscribe(query(), noop)
  transport.receive(transition(zero, version(1, 1n), [updated(0, 'old', null)]))
  release()
  client.subscribe(query(), current)

  transport.receive(
    transition(version(1, 1n), version(3, 2n), [
      { queryId: 0, type: 'QueryRemoved' },
      updated(1, 'new', null)
    ])
  )

  expect(current).toHaveBeenCalledWith({ status: 'success', value: 'new' })
})

it('rejects a transition with the wrong start version without changing state', () => {
  const { client, transport } = setup()
  const listener = vi.fn()
  transport.connect()
  client.subscribe(query(), listener)

  expect(() =>
    transport.receive(
      transition(version(1, 0n), version(1, 1n), [updated(0, 'invalid', null)])
    )
  ).toThrow(SyncProtocolError)
  expect(listener).not.toHaveBeenCalled()

  transport.receive(
    transition(zero, version(1, 1n), [updated(0, 'valid', null)])
  )
  expect(listener).toHaveBeenCalledWith({ status: 'success', value: 'valid' })
})

it('applies a transition atomically when a later modification is invalid', () => {
  const { client, transport } = setup()
  const listener = vi.fn()
  transport.connect()
  client.subscribe(query(), listener)

  expect(() =>
    transport.receive(
      transition(zero, version(1, 1n), [
        updated(0, 'would leak', null),
        updated(99, 'unknown', null)
      ])
    )
  ).toThrow('Unknown query ID: 99')
  expect(listener).not.toHaveBeenCalled()

  transport.receive(
    transition(zero, version(1, 1n), [updated(0, 'committed', null)])
  )
  expect(listener).toHaveBeenCalledWith({
    status: 'success',
    value: 'committed'
  })
})

it('isolates listeners and notifies only queries changed by a transition', () => {
  const { client, transport } = setup()
  const changed = vi.fn()
  const unchanged = vi.fn()
  transport.connect()
  client.subscribe(query(), () => {
    throw new Error('listener failed')
  })
  client.subscribe(query(), changed)
  client.subscribe(otherQuery(), unchanged)

  transport.receive(
    transition(zero, version(2, 1n), [updated(0, 'changed', null)])
  )

  expect(changed).toHaveBeenCalledOnce()
  expect(unchanged).not.toHaveBeenCalled()
})

it('retains query journals and the maximum timestamp across reconnects', () => {
  const { client, transport } = setup()
  transport.connect()
  client.subscribe(query(), noop)
  transport.receive(
    transition(zero, version(1, 7n), [updated(0, 'value', 'opaque')])
  )
  transport.disconnect('network lost')
  transport.reconnect()

  expect(transport.frames.at(-2)).toMatchObject({
    connectionCount: 1,
    lastCloseReason: 'network lost',
    maxObservedTimestamp: 7n,
    sessionId: 'session-id',
    type: 'Connect'
  })
  expect(transport.frames.at(-1)).toMatchObject({
    modifications: [expect.objectContaining({ journal: 'opaque', queryId: 0 })]
  })
})

it('sends mutations with monotonically increasing request IDs', () => {
  const { client, transport } = setup()
  transport.connect()
  void client.mutation({ args: { value: 1 }, path: 'values:set' })
  void client.mutation({ args: { value: 2 }, path: 'values:set' })

  expect(transport.frames.slice(-2)).toMatchObject([
    { requestId: 0, type: 'Mutation' },
    { requestId: 1, type: 'Mutation' }
  ])
})

it('routes concurrent action responses by request ID', async () => {
  const { client, transport } = setup()
  transport.connect()
  const first = client.action({ args: { value: 1 }, path: 'values:act' })
  const second = client.action({ args: { value: 2 }, path: 'values:act' })

  expect(transport.frames.slice(-2)).toEqual([
    {
      args: [{ value: 1 }],
      requestId: 0,
      type: 'Action',
      udfPath: 'values:act'
    },
    {
      args: [{ value: 2 }],
      requestId: 1,
      type: 'Action',
      udfPath: 'values:act'
    }
  ])

  transport.receive({
    requestId: 1,
    result: 'second',
    success: true,
    type: 'ActionResponse'
  })
  transport.receive({
    requestId: 0,
    result: 'first',
    success: true,
    type: 'ActionResponse'
  })

  await expect(first).resolves.toBe('first')
  await expect(second).resolves.toBe('second')
})

it('reports queued, successful, and failed actions to devtools history', async () => {
  const { client, transport } = setup()
  const listener = vi.fn()
  client.subscribeDevtools(listener)
  const success = client.action({ args: { value: 'yes' }, path: 'values:act' })

  expect(client.getDevtoolsSnapshot().actions).toEqual([
    expect.objectContaining({
      args: { value: 'yes' },
      phase: 'queued',
      requestId: 0,
      startedAt: 123
    })
  ])
  transport.connect()
  expect(client.getDevtoolsSnapshot().actions).toEqual([
    expect.objectContaining({ phase: 'sent' })
  ])
  transport.receive({
    requestId: 0,
    result: 'yes',
    success: true,
    type: 'ActionResponse'
  })
  await success
  expect(client.getDevtoolsSnapshot().actions).toEqual([
    expect.objectContaining({
      completedAt: 123,
      phase: 'success',
      result: 'yes'
    })
  ])

  const failure = client.action({ args: {}, path: 'values:failAction' })
  transport.receive({
    errorData: { code: 'FAILED' },
    requestId: 1,
    result: 'action failed',
    success: false,
    type: 'ActionResponse'
  })
  await expect(failure).rejects.toThrow('action failed')
  expect(client.getDevtoolsSnapshot().actions[0]).toMatchObject({
    error: expect.any(Error),
    phase: 'error',
    requestId: 1
  })
  expect(listener).toHaveBeenCalled()
})

it('queues an action until the initial connection opens', () => {
  const { client, transport } = setup()
  void client.action({ args: { value: 1 }, path: 'values:act' })

  expect(transport.frames).toEqual([])
  transport.connect()

  expect(transport.frames.at(-1)).toEqual({
    args: [{ value: 1 }],
    requestId: 0,
    type: 'Action',
    udfPath: 'values:act'
  })
})

it('rejects a failed action without closing the client', async () => {
  const { client, transport } = setup()
  transport.connect()
  const action = client.action({ args: {}, path: 'values:failAction' })
  transport.receive({
    errorData: { code: 'FAILED' },
    requestId: 0,
    result: 'action failed',
    success: false,
    type: 'ActionResponse'
  })

  const actionError = await action.catch((error: unknown) => error)
  expect(actionError).toBeInstanceOf(ConvexError)
  expect(actionError).toMatchObject({
    data: { code: 'FAILED' },
    message: 'action failed',
    name: 'ConvexError'
  })
  expect(() => client.subscribe(query(), noop)).not.toThrow()
})

it('does not replay an in-flight action after reconnect', async () => {
  const { client, transport } = setup()
  transport.connect()
  const action = client.action({ args: { value: 1 }, path: 'values:act' })

  transport.disconnect()
  transport.reconnect()

  await expect(action).rejects.toEqual(
    expect.objectContaining({
      message: 'Connection lost while action was in flight',
      name: 'SyncActionError'
    })
  )
  expect(client.getDevtoolsSnapshot().actions).toEqual([
    expect.objectContaining({
      error: expect.any(Error),
      phase: 'error',
      requestId: 0
    })
  ])
  expect(transport.frames.filter((frame) => frame.type === 'Action')).toEqual([
    {
      args: [{ value: 1 }],
      requestId: 0,
      type: 'Action',
      udfPath: 'values:act'
    }
  ])
})

it('rejects a failed mutation without closing the client', async () => {
  const { client, transport } = setup()
  transport.connect()
  const mutation = client.mutation({ args: {}, path: 'values:fail' })
  transport.receive({
    errorData: { code: 'FAILED' },
    requestId: 0,
    result: 'failed',
    success: false,
    type: 'MutationResponse'
  })

  const mutationError = await mutation.catch((error: unknown) => error)
  expect(mutationError).toBeInstanceOf(ConvexError)
  expect(mutationError).toMatchObject({
    data: { code: 'FAILED' },
    message: 'failed',
    name: 'ConvexError'
  })
  expect(() => client.subscribe(query(), noop)).not.toThrow()
})

it('waits for reflection and publishes query data before resolving a mutation', async () => {
  const { client, transport } = setup()
  const events: string[] = []
  transport.connect()
  client.subscribeMutationTransitions({
    begin: (requestIds) => events.push(`begin:${requestIds.join(',')}`),
    end: () => events.push('end')
  })
  client.subscribe(query(), () => events.push('query'))
  const mutation = client
    .mutation({ args: { value: 'after' }, path: 'values:set' })
    .then(() => events.push('mutation'))
  transport.receive({
    requestId: 0,
    result: 'after',
    success: true,
    ts: 2n,
    type: 'MutationResponse'
  })
  await Promise.resolve()
  expect(events).toEqual([])

  transport.receive(
    transition(zero, version(1, 2n), [updated(0, 'after', null)])
  )
  await mutation

  expect(events).toEqual(['begin:0', 'query', 'end', 'mutation'])
})

it('reports each pending mutation queue phase to devtools', async () => {
  const { client, transport } = setup()
  const listener = vi.fn()
  client.subscribeDevtools(listener)
  const mutation = client.mutation({
    args: { value: 'after' },
    path: 'values:set'
  })

  expect(client.getDevtoolsSnapshot()).toMatchObject({
    connection: 'connecting',
    mutations: [
      {
        args: { value: 'after' },
        path: 'values:set',
        phase: 'queued',
        requestId: 0,
        startedAt: 123
      }
    ]
  })

  transport.connect()
  expect(client.getDevtoolsSnapshot()).toMatchObject({
    connection: 'connected',
    mutations: [{ phase: 'sent' }]
  })

  transport.receive({
    requestId: 0,
    result: 'after',
    success: true,
    ts: 2n,
    type: 'MutationResponse'
  })
  expect(client.getDevtoolsSnapshot().mutations).toEqual([
    expect.objectContaining({ phase: 'awaiting-transition' })
  ])

  transport.receive(transition(zero, version(0, 2n), []))
  await expect(mutation).resolves.toBe('after')
  expect(client.getDevtoolsSnapshot().mutations).toEqual([
    expect.objectContaining({
      completedAt: 123,
      error: null,
      phase: 'success',
      result: 'after'
    })
  ])
  expect(listener).toHaveBeenCalled()
})

it('warns before unload until all pending mutations and actions settle', async () => {
  const transport = new FakeTransport()
  const beforeUnloadTarget = new FakeBeforeUnloadTarget()
  const client = new SyncClient(transport, {
    beforeUnloadTarget,
    now: () => 123,
    randomUuid: () => 'session-id'
  })
  transport.connect()

  const mutation = client.mutation({ args: {}, path: 'values:set' })
  const action = client.action({ args: {}, path: 'values:act' })

  expect(beforeUnloadTarget.listeners).toHaveLength(1)
  expect(beforeUnloadTarget.dispatch()).toMatchObject({
    defaultPrevented: true,
    returnValue: true
  })

  transport.receive({
    requestId: 1,
    result: 'acted',
    success: true,
    type: 'ActionResponse'
  })
  await expect(action).resolves.toBe('acted')
  expect(beforeUnloadTarget.listeners).toHaveLength(1)

  transport.receive({
    requestId: 0,
    result: 'mutated',
    success: true,
    ts: 2n,
    type: 'MutationResponse'
  })
  transport.receive(transition(zero, version(0, 2n), []))
  await expect(mutation).resolves.toBe('mutated')
  expect(beforeUnloadTarget.listeners).toHaveLength(0)

  const failedMutation = client.mutation({ args: {}, path: 'values:fail' })
  const failedAction = client.action({ args: {}, path: 'values:failAction' })
  const failedMutationExpectation =
    expect(failedMutation).rejects.toThrow('Mutation failed')
  const failedActionExpectation =
    expect(failedAction).rejects.toThrow('Action failed')
  transport.receive({
    requestId: 3,
    result: 'Action failed',
    success: false,
    type: 'ActionResponse'
  })
  await failedActionExpectation
  expect(beforeUnloadTarget.listeners).toHaveLength(1)
  transport.receive({
    requestId: 2,
    result: 'Mutation failed',
    success: false,
    type: 'MutationResponse'
  })
  await failedMutationExpectation
  expect(beforeUnloadTarget.listeners).toHaveLength(0)

  const pendingAction = client.action({ args: {}, path: 'values:pending' })
  expect(beforeUnloadTarget.listeners).toHaveLength(1)
  await client.close()
  await expect(pendingAction).rejects.toBeInstanceOf(SyncClientClosedError)
  expect(beforeUnloadTarget.listeners).toHaveLength(0)
})

it('retains decoded Convex mutation results in devtools history', async () => {
  const { client, transport } = setup()
  const result = {
    bigint: -9_223_372_036_854_775_808n,
    bytes: new Uint8Array([0, 1, 255]).buffer,
    infinity: Number.POSITIVE_INFINITY,
    nan: Number.NaN,
    negativeInfinity: Number.NEGATIVE_INFINITY,
    negativeZero: -0
  }
  transport.connect()
  const mutation = client.mutation({
    args: { value: 'rich' },
    path: 'values:set'
  })

  transport.receive({
    requestId: 0,
    result,
    success: true,
    ts: 2n,
    type: 'MutationResponse'
  })
  transport.receive(transition(zero, version(0, 2n), []))

  await expect(mutation).resolves.toEqual(result)
  expect(client.getDevtoolsSnapshot().mutations).toEqual([
    expect.objectContaining({ phase: 'success', result })
  ])
})

it('retains failed mutations in devtools history', async () => {
  const { client, transport } = setup()
  transport.connect()
  const mutation = client.mutation({
    args: { value: 'broken' },
    path: 'values:set'
  })

  transport.receive({
    errorData: { code: 'BROKEN' },
    requestId: 0,
    result: 'Mutation failed',
    success: false,
    type: 'MutationResponse'
  })

  await expect(mutation).rejects.toThrow('Mutation failed')
  expect(client.getDevtoolsSnapshot().mutations).toEqual([
    expect.objectContaining({
      completedAt: 123,
      error: expect.any(Error),
      phase: 'error',
      result: undefined
    })
  ])
})

it('replays pending mutations with the same request ID after reconnect', () => {
  const { client, transport } = setup()
  transport.connect()
  void client.mutation({ args: { value: 1 }, path: 'values:set' })
  transport.disconnect()
  transport.reconnect()

  expect(transport.frames.filter((frame) => frame.type === 'Mutation')).toEqual(
    [
      {
        args: [{ value: 1 }],
        requestId: 0,
        type: 'Mutation',
        udfPath: 'values:set'
      },
      {
        args: [{ value: 1 }],
        requestId: 0,
        type: 'Mutation',
        udfPath: 'values:set'
      }
    ]
  )
})

it('authenticates before sending queries and reports server confirmation', async () => {
  const { client, transport } = setup()
  const onChange = vi.fn()
  const listener = vi.fn()

  client.setAuth(
    ({ forceRefreshToken }) => {
      expect(forceRefreshToken).toBe(false)
      return Promise.resolve('user-token')
    },
    { onChange }
  )
  client.subscribe(query(), listener)
  transport.connect()

  expect(transport.frames).toEqual([
    expect.objectContaining({ type: 'Connect' })
  ])
  await flushPromises()
  expect(transport.frames.slice(1).map((frame) => frame.type)).toEqual([
    'Authenticate',
    'ModifyQuerySet'
  ])
  expect(transport.frames[1]).toEqual({
    baseVersion: 0,
    tokenType: 'User',
    type: 'Authenticate',
    value: 'user-token'
  })
  expect(onChange).not.toHaveBeenCalled()

  transport.receive(
    transition(zero, identityVersion(1, 1, 1n), [
      updated(0, 'authenticated', null)
    ])
  )

  expect(onChange).toHaveBeenCalledOnce()
  expect(onChange).toHaveBeenCalledWith(true)
  expect(listener).toHaveBeenCalledWith({
    status: 'success',
    value: 'authenticated'
  })
})

it('gates new queries, mutations, and actions until auth is confirmed', async () => {
  const { client, transport } = setup()
  transport.connect()
  client.subscribe(query(), noop)
  client.setAuth(() => Promise.resolve('user-token'))
  client.subscribe(otherQuery(), noop)
  void client.mutation({ args: { value: 1 }, path: 'values:set' })
  void client.action({ args: { value: 2 }, path: 'values:act' })
  await flushPromises()

  expect(transport.frames.slice(2).map((frame) => frame.type)).toEqual([
    'Authenticate'
  ])

  transport.receive(
    transition(zero, identityVersion(1, 1, 1n), [
      updated(0, 'authenticated', null)
    ])
  )

  expect(transport.frames.slice(2).map((frame) => frame.type)).toEqual([
    'Authenticate',
    'ModifyQuerySet',
    'Mutation',
    'Action'
  ])
  expect(transport.frames[3]).toMatchObject({
    modifications: [expect.objectContaining({ queryId: 1, type: 'Add' })]
  })
})

it('does not publish a cached anonymous result during an auth change', async () => {
  const { client, transport } = setup()
  const lateListener = vi.fn()
  transport.connect()
  client.subscribe(query(), noop)
  transport.receive(
    transition(zero, version(1, 1n), [updated(0, 'anonymous', null)])
  )

  client.setAuth(() => Promise.resolve('user-token'))
  client.subscribe(query(), lateListener)
  await flushPromises()

  expect(lateListener).not.toHaveBeenCalled()
  transport.receive(
    transition(version(1, 1n), identityVersion(1, 1, 2n), [
      updated(0, 'authenticated', null)
    ])
  )
  expect(lateListener).toHaveBeenCalledWith({
    status: 'success',
    value: 'authenticated'
  })
})

it('clears auth with a None token and releases queued work after confirmation', async () => {
  const { client, transport } = setup()
  const onChange = vi.fn()
  client.setAuth(() => Promise.resolve('user-token'), { onChange })
  transport.connect()
  await flushPromises()
  transport.receive(transition(zero, identityVersion(1, 0, 1n), []))
  onChange.mockClear()

  client.clearAuth()
  void client.mutation({ args: {}, path: 'values:set' })

  expect(transport.frames.at(-1)).toEqual({
    baseVersion: 1,
    tokenType: 'None',
    type: 'Authenticate'
  })
  expect(transport.frames.filter((frame) => frame.type === 'Mutation')).toEqual(
    []
  )

  transport.receive(
    transition(identityVersion(1, 0, 1n), identityVersion(2, 0, 2n), [])
  )

  expect(onChange).toHaveBeenCalledWith(false)
  expect(transport.frames.at(-1)).toMatchObject({ type: 'Mutation' })
})

it('calls the default auth refresh timer with the global receiver', async () => {
  const transport = new FakeTransport()
  const timer = { id: 1 }
  const setTimer = vi
    .spyOn(globalThis, 'setTimeout')
    .mockImplementation(
      function setTimerWithReceiver(
        this: typeof globalThis,
        _callback,
        _delay
      ) {
        expect(this).toBe(globalThis)

        return timer as unknown as ReturnType<typeof setTimeout>
      }
    )
  const client = new SyncClient(transport, {
    now: () => 123,
    randomUuid: () => 'session-id'
  })
  const token = `header.${btoa(JSON.stringify({ exp: 1000 }))}.signature`

  client.setAuth(() => Promise.resolve(token))
  transport.connect()
  await flushPromises()
  transport.receive(transition(zero, identityVersion(1, 0, 1n), []))

  expect(setTimer).toHaveBeenCalledOnce()
  await client.close()
  setTimer.mockRestore()
})

it('ignores an outdated token fetch after setAuth is replaced', async () => {
  const { client, transport } = setup()
  let resolveFirst!: (token: string) => void
  const first = new Promise<string>((resolve) => {
    resolveFirst = resolve
  })

  transport.connect()
  client.setAuth(() => first)
  client.setAuth(() => Promise.resolve('new-token'))
  await flushPromises()
  resolveFirst('old-token')
  await flushPromises()

  expect(
    transport.frames.filter((frame) => frame.type === 'Authenticate')
  ).toEqual([
    {
      baseVersion: 0,
      tokenType: 'User',
      type: 'Authenticate',
      value: 'new-token'
    }
  ])
})

it('fetches a fresh token after AuthError and restores auth on reconnect', async () => {
  const { client, transport } = setup()
  const refreshChanges: boolean[] = []
  const fetchToken = vi
    .fn()
    .mockResolvedValueOnce('cached-token')
    .mockResolvedValueOnce('fresh-token')

  client.setAuth(fetchToken, {
    onRefreshChange: (isRefreshing) => refreshChanges.push(isRefreshing)
  })
  transport.connect()
  await flushPromises()
  transport.receive({
    authUpdateAttempted: true,
    baseVersion: 0,
    error: 'expired',
    type: 'AuthError'
  })
  await flushPromises()
  transport.disconnect('auth rejected')
  transport.reconnect()

  expect(fetchToken).toHaveBeenNthCalledWith(1, { forceRefreshToken: false })
  expect(fetchToken).toHaveBeenNthCalledWith(2, { forceRefreshToken: true })
  expect(transport.frames.slice(-2).map((frame) => frame.type)).toEqual([
    'Connect',
    'Authenticate'
  ])
  expect(transport.frames.at(-1)).toMatchObject({ value: 'fresh-token' })

  transport.receive(transition(zero, identityVersion(1, 0, 2n), []))
  expect(refreshChanges).toEqual([true, false])
})

it('reconnects with Authenticate before queries and pending mutations', async () => {
  const { client, transport } = setup()
  client.setAuth(() => Promise.resolve('user-token'))
  client.subscribe(query(), noop)
  transport.connect()
  await flushPromises()
  transport.receive(
    transition(zero, identityVersion(1, 1, 1n), [updated(0, 'value', null)])
  )
  void client.mutation({ args: {}, path: 'values:set' })
  transport.disconnect()
  transport.reconnect()

  expect(transport.frames.slice(-3).map((frame) => frame.type)).toEqual([
    'Connect',
    'Authenticate',
    'ModifyQuerySet'
  ])

  transport.receive(
    transition(zero, identityVersion(1, 1, 2n), [updated(0, 'value', null)])
  )
  expect(transport.frames.at(-1)).toMatchObject({ type: 'Mutation' })
})

it('rejects pending and new operations after closing idempotently', async () => {
  const { client, transport } = setup()
  transport.connect()
  const pending = client.mutation({ args: {}, path: 'values:set' })
  const pendingAction = client.action({ args: {}, path: 'values:act' })

  await client.close()
  await client.close()

  await expect(pending).rejects.toBeInstanceOf(SyncClientClosedError)
  await expect(pendingAction).rejects.toBeInstanceOf(SyncClientClosedError)
  await expect(
    client.mutation({ args: {}, path: 'values:set' })
  ).rejects.toBeInstanceOf(SyncClientClosedError)
  await expect(
    client.action({ args: {}, path: 'values:act' })
  ).rejects.toBeInstanceOf(SyncClientClosedError)
  expect(() => client.subscribe(query(), noop)).toThrow(SyncClientClosedError)
  expect(transport.closed).toBe(true)
})

type FakeBeforeUnloadEvent = {
  defaultPrevented: boolean
  preventDefault: () => void
  returnValue: unknown
}
