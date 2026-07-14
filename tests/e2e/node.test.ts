import { randomUUID } from 'node:crypto'

import { ConvexPulseClient } from 'convex-pulse'
import {
  ConvexPulseHttpClient,
  preloadedQueryArgs,
  preloadedQueryResult
} from 'convex-pulse/http'
import { makeFunctionReference } from 'convex/server'
import { ConvexError } from 'convex/values'
import { expect, it, vi } from 'vitest'

import { api } from '#convex/api'

const url = process.env.CONVEX_URL
const clerkToken = process.env.CLERK_E2E_TOKEN
const clerkFreshToken = process.env.CLERK_E2E_FRESH_TOKEN
const clerkUserId = process.env.CLERK_E2E_USER_ID

if (
  url === undefined ||
  clerkToken === undefined ||
  clerkFreshToken === undefined ||
  clerkUserId === undefined
) {
  throw new Error(
    'CONVEX_URL and the Clerk E2E fixture environment are required'
  )
}

function deferred<Value>(): Deferred<Value> {
  let resolveDeferred!: Deferred<Value>['resolve']
  const promise = new Promise<Value>((resolve) => {
    resolveDeferred = resolve
  })

  return { promise, resolve: resolveDeferred }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function installWebSocketTracking() {
  const OriginalWebSocket = globalThis.WebSocket
  const frames: unknown[] = []
  const sockets: WebSocket[] = []
  let active = true

  const RecordingWebSocket = new Proxy(OriginalWebSocket, {
    construct(target, argumentsList, newTarget) {
      const socket = Reflect.construct(
        target,
        argumentsList,
        newTarget
      ) as WebSocket
      const send = socket.send.bind(socket)
      socket.send = (data) => {
        if (typeof data === 'string') {
          frames.push(JSON.parse(data) as unknown)
        }
        send(data)
      }
      sockets.push(socket)
      return socket
    }
  })

  globalThis.WebSocket = RecordingWebSocket

  function restore() {
    if (!active) {
      return
    }
    active = false
    globalThis.WebSocket = OriginalWebSocket
  }

  return { frames, restore, sockets }
}

function countQueryModification(
  frames: readonly unknown[],
  type: 'Add' | 'Remove'
) {
  let count = 0
  for (const frame of frames) {
    if (
      !isRecord(frame) ||
      frame.type !== 'ModifyQuerySet' ||
      !Array.isArray(frame.modifications)
    ) {
      continue
    }
    for (const modification of frame.modifications) {
      if (isRecord(modification) && modification.type === type) {
        count += 1
      }
    }
  }
  return count
}

function countRequest(frames: readonly unknown[], type: string) {
  return frames.filter((frame) => isRecord(frame) && frame.type === type).length
}

async function waitForOpenSocket(
  sockets: readonly WebSocket[],
  minimumCount: number
) {
  await vi.waitFor(
    () => {
      expect(sockets.length).toBeGreaterThanOrEqual(minimumCount)
      expect(sockets.at(-1)?.readyState).toBe(WebSocket.OPEN)
    },
    { interval: 20, timeout: 3000 }
  )
  return sockets.at(-1) as WebSocket
}

function richValue(label: string, integer: bigint, byte: number): RichValue {
  return {
    bigint: integer,
    bytes: new Uint8Array([0, byte, 255]).buffer,
    infinity: Number.POSITIVE_INFINITY,
    label,
    nan: Number.NaN,
    negativeInfinity: Number.NEGATIVE_INFINITY,
    negativeZero: -0,
    nested: [null, true, 'pulse', { count: 3 }]
  }
}

function expectRichValue(actual: unknown, expected: RichValue) {
  expect(isRecord(actual)).toBe(true)
  if (!isRecord(actual)) {
    return
  }
  expect(actual.bigint).toBe(expected.bigint)
  expect(actual.bytes).toBeInstanceOf(ArrayBuffer)
  if (actual.bytes instanceof ArrayBuffer) {
    expect(new Uint8Array(actual.bytes)).toEqual(new Uint8Array(expected.bytes))
  }
  expect(actual.infinity).toBe(Number.POSITIVE_INFINITY)
  expect(actual.label).toBe(expected.label)
  expect(actual.nan).toBeNaN()
  expect(actual.negativeInfinity).toBe(Number.NEGATIVE_INFINITY)
  expect(Object.is(actual.negativeZero, -0)).toBe(true)
  expect(actual.nested).toEqual(expected.nested)
}

function noop() {}

it('connects a ConvexPulseClient to a real Convex deployment', async () => {
  const client = new ConvexPulseClient(url)

  try {
    await expect(
      client.query(api.fixture.getValue, {
        args: {
          key: 'connection-check',
          runId: randomUUID()
        }
      })
    ).resolves.toBeNull()
  } finally {
    await client.close()
  }
})

it('runs HTTP calls and creates a transport-safe preloaded query', async () => {
  const client = new ConvexPulseHttpClient(url, {
    skipConvexDeploymentUrlCheck: true
  })
  const runId = randomUUID()
  const args = { key: 'http', runId }

  try {
    await expect(
      client.query(api.fixture.getValue, { args })
    ).resolves.toBeNull()
    await expect(
      client.mutation(api.fixture.setValue, {
        args: { ...args, value: 'from HTTP' }
      })
    ).resolves.toBe('from HTTP')
    await expect(
      client.action(api.fixture.echoAction, {
        args: { value: 'from action' }
      })
    ).resolves.toBe('from action')

    const preloaded = await client.preloadQuery(api.fixture.getValue, { args })
    // eslint-disable-next-line unicorn/prefer-structured-clone -- This assertion specifically verifies JSON transport safety.
    expect(JSON.parse(JSON.stringify(preloaded))).toEqual(preloaded)
    expect(preloadedQueryArgs(preloaded)).toEqual(args)
    expect(preloadedQueryResult(preloaded)).toBe('from HTTP')
  } finally {
    await client.mutation(api.fixture.removeRun, { args: { runId } })
  }
})

it('retries real queries, mutations, and actions only when configured', async () => {
  const tracking = installWebSocketTracking()
  const client = new ConvexPulseClient(url)

  try {
    await expect(
      client.query(api.fixture.throwQueryError, { args: {} })
    ).rejects.toThrow('E2E query error')
    expect(countQueryModification(tracking.frames, 'Add')).toBe(1)

    await expect(
      client.query(api.fixture.throwQueryError, { args: {}, retries: 1 })
    ).rejects.toThrow('E2E query error')
    expect(countQueryModification(tracking.frames, 'Add')).toBe(3)

    await expect(
      client.mutation(api.fixture.throwMutationError, { args: {} })
    ).rejects.toThrow('E2E mutation error')
    expect(countRequest(tracking.frames, 'Mutation')).toBe(1)

    await expect(
      client.mutation(api.fixture.throwMutationError, {
        args: {},
        retries: 1
      })
    ).rejects.toThrow('E2E mutation error')
    expect(countRequest(tracking.frames, 'Mutation')).toBe(3)

    await expect(
      client.action(api.fixture.throwActionError, { args: {} })
    ).rejects.toThrow('E2E action error')
    expect(countRequest(tracking.frames, 'Action')).toBe(1)

    await expect(
      client.action(api.fixture.throwActionError, { args: {}, retries: 1 })
    ).rejects.toThrow('E2E action error')
    expect(countRequest(tracking.frames, 'Action')).toBe(3)
  } finally {
    tracking.restore()
    await client.close()
  }
})

it('authenticates with a real Clerk JWT and exposes the Convex identity', async () => {
  const tokenRequests: boolean[] = []
  const client = new ConvexPulseClient(url, {
    fetchToken: ({ forceRefreshToken }) => {
      tokenRequests.push(forceRefreshToken)
      return Promise.resolve(clerkToken)
    }
  })

  try {
    await expect(
      client.query(api.fixture.getIdentity, { args: {} })
    ).resolves.toMatchObject({
      email: expect.stringContaining('convex-pulse-'),
      name: 'Pulse E2E',
      subject: clerkUserId,
      tokenIdentifier: expect.stringContaining(clerkUserId)
    })
    await expect(
      client.mutation(api.fixture.requireIdentity, { args: {} })
    ).resolves.toBe(clerkUserId)
    expect(tokenRequests).toEqual([false])
  } finally {
    await client.close()
  }
})

it('queues an authenticated query while the token fetch is pending', async () => {
  const client = new ConvexPulseClient(url)
  const tokenFetch = deferred<string>()

  try {
    client.setAuth(() => tokenFetch.promise)
    const identity = client.query(api.fixture.getIdentity, { args: {} })

    await delay(25)
    tokenFetch.resolve(clerkToken)

    await expect(identity).resolves.toMatchObject({ subject: clerkUserId })
  } finally {
    await client.close()
  }
})

it('clears auth and re-runs a live query as anonymous', async () => {
  const client = new ConvexPulseClient(url)
  const authenticatedIdentity = deferred<unknown>()
  const anonymousIdentity = deferred<unknown>()
  const authChanges: boolean[] = []
  let release = noop

  try {
    client.setAuth(() => Promise.resolve(clerkToken), {
      onChange: (isAuthenticated) => authChanges.push(isAuthenticated)
    })
    release = client.onUpdate(
      api.fixture.getIdentity,
      { args: {} },
      (identity) => {
        if (identity === null) {
          anonymousIdentity.resolve(identity)
        } else {
          authenticatedIdentity.resolve(identity)
        }
      }
    )

    await expect(authenticatedIdentity.promise).resolves.toMatchObject({
      subject: clerkUserId
    })
    client.clearAuth()
    await expect(anonymousIdentity.promise).resolves.toBeNull()
    expect(authChanges).toEqual([true, false])
    await expect(
      client.mutation(api.fixture.requireIdentity, { args: {} })
    ).rejects.toThrow('Authentication required')
  } finally {
    release()
    await client.close()
  }
})

it('forces a fresh Clerk token after the server rejects auth', async () => {
  const client = new ConvexPulseClient(url)
  const refreshChanges: boolean[] = []
  const tokenRequests: boolean[] = []

  try {
    client.setAuth(
      ({ forceRefreshToken }) => {
        tokenRequests.push(forceRefreshToken)
        return Promise.resolve(
          forceRefreshToken ? clerkFreshToken : 'invalid.fixture.token'
        )
      },
      {
        onRefreshChange: (isRefreshing) => refreshChanges.push(isRefreshing)
      }
    )

    await expect(
      client.query(api.fixture.getIdentity, { args: {} })
    ).resolves.toMatchObject({ subject: clerkUserId })
    expect(tokenRequests).toEqual([false, true])
    expect(refreshChanges).toEqual([true, false])
  } finally {
    await client.close()
  }
}, 15_000)

it('executes a query once with the provided args and returns its result', async () => {
  const client = new ConvexPulseClient(url)
  const runId = randomUUID()
  const value = { answer: 42, runId }

  try {
    await client.mutation(api.fixture.setValue, {
      args: { key: 'query', runId, value }
    })

    await expect(
      client.query(api.fixture.getValue, {
        args: { key: 'query', runId }
      })
    ).resolves.toEqual(value)
    await expect(
      client.query(api.fixture.getValue, {
        args: { key: 'different-key', runId }
      })
    ).resolves.toBeNull()
  } finally {
    await client.close()
  }
})

it('loads real paginated query pages through Node watchQuery', async () => {
  const client = new ConvexPulseClient(url)
  const stream = client.watchQuery(api.fixture.paginateLabels, {
    args: { prefix: 'node' },
    pagination: { initialNumItems: 2 }
  })
  const iterator = stream[Symbol.asyncIterator]()
  try {
    const first = await iterator.next()
    expect(first.value?.data).toEqual(['node-1', 'node-2'])
    first.value?.loadMore(3)
    const second = await iterator.next()
    expect(second.value?.data).toEqual([
      'node-1',
      'node-2',
      'node-3',
      'node-4',
      'node-5'
    ])
  } finally {
    await iterator.return?.()
    await client.close()
  }
})

it('publishes optimistic updates across aggregated paginated results', async () => {
  const client = new ConvexPulseClient(url)
  const prefix = `optimistic-pages-${randomUUID()}`
  const stream = client.watchQuery(api.fixture.paginateLabels, {
    args: { prefix },
    pagination: { initialNumItems: 2 }
  })
  const iterator = stream[Symbol.asyncIterator]()
  try {
    const first = await iterator.next()
    first.value?.loadMore(3)
    const loaded = await iterator.next()
    expect(loaded.value?.data).toHaveLength(5)

    const optimisticResult = iterator.next()
    const mutation = client.mutation(api.fixture.setValue, {
      args: {
        key: 'paginated-optimistic',
        runId: randomUUID(),
        value: true
      },
      optimistic: ({ store }) => {
        const pages = store.paginated(api.fixture.paginateLabels, { prefix })
        pages.prepend('top')
        pages.update(`${prefix}-3`, 'updated')
        pages.appendIfLoaded('bottom')
      }
    })

    await expect(optimisticResult).resolves.toMatchObject({
      value: {
        data: [
          'top',
          `${prefix}-1`,
          `${prefix}-2`,
          'updated',
          `${prefix}-4`,
          `${prefix}-5`,
          'bottom'
        ]
      }
    })
    await mutation
    await expect(iterator.next()).resolves.toMatchObject({
      value: {
        data: [
          `${prefix}-1`,
          `${prefix}-2`,
          `${prefix}-3`,
          `${prefix}-4`,
          `${prefix}-5`
        ]
      }
    })
  } finally {
    await iterator.return?.()
    await client.close()
  }
})

it('does not retain a live subscription after a one-shot query completes', async () => {
  const tracking = installWebSocketTracking()
  const client = new ConvexPulseClient(url)

  try {
    await client.query(api.fixture.getValue, {
      args: { key: 'one-shot', runId: randomUUID() }
    })

    const addCount = countQueryModification(tracking.frames, 'Add')
    const removeCount = countQueryModification(tracking.frames, 'Remove')

    expect(addCount).toBeGreaterThan(0)
    expect(removeCount).toBe(addCount)
  } finally {
    await client.close()
    tracking.restore()
  }
})

it('executes a mutation with the provided args and returns its result', async () => {
  const client = new ConvexPulseClient(url)
  const runId = randomUUID()
  const value = { source: 'mutation', value: 17 }

  try {
    await expect(
      client.mutation(api.fixture.setValue, {
        args: { key: 'mutation', runId, value }
      })
    ).resolves.toEqual(value)
    await expect(
      client.query(api.fixture.getValue, {
        args: { key: 'mutation', runId }
      })
    ).resolves.toEqual(value)
  } finally {
    await client.close()
  }
})

it('publishes an optimistic mutation update before the real deployment responds', async () => {
  const client = new ConvexPulseClient(url)
  const runId = randomUUID()
  const initial = deferred<unknown>()
  const optimistic = deferred<unknown>()
  const settled = deferred<unknown>()
  const valueList: unknown[] = []
  let release = noop

  try {
    await client.mutation(api.fixture.setValue, {
      args: { key: 'node-optimistic', runId, value: ['server'] }
    })
    release = client.onUpdate(
      api.fixture.getValue,
      { args: { key: 'node-optimistic', runId } },
      (value) => {
        valueList.push(value)
        if (Array.isArray(value) && value.length === 1) {
          initial.resolve(value)
        } else if (Array.isArray(value) && value.at(-1) === 'optimistic') {
          if (value.length === 2) {
            optimistic.resolve(value)
          }
          if (value.length === 3) {
            settled.resolve(value)
          }
        }
      }
    )
    await expect(initial.promise).resolves.toEqual(['server'])

    const mutation = client.mutation(api.fixture.setValue, {
      args: {
        key: 'node-optimistic',
        runId,
        value: ['server', 'deployment', 'optimistic']
      },
      optimistic: ({ store }) =>
        store
          .get(arrayValue, {
            key: 'node-optimistic',
            runId
          })
          .append('optimistic')
    })

    await expect(optimistic.promise).resolves.toEqual(['server', 'optimistic'])
    await expect(mutation).resolves.toEqual([
      'server',
      'deployment',
      'optimistic'
    ])
    await expect(settled.promise).resolves.toEqual([
      'server',
      'deployment',
      'optimistic'
    ])
    expect(valueList).toContainEqual(['server', 'optimistic'])
    expect(valueList).not.toContainEqual([
      'server',
      'deployment',
      'optimistic',
      'optimistic'
    ])
  } finally {
    release()
    await client.mutation(api.fixture.removeRun, { args: { runId } })
    await client.close()
  }
})

it('applies keyed collection operations through the public optimistic API', async () => {
  const client = new ConvexPulseClient(url)
  const runId = randomUUID()
  const initial = deferred<Task[]>()
  const optimistic = deferred<Task[]>()
  const initialValue: Task[] = [
    { _id: 'a', label: 'A', rank: 1 },
    { _id: 'b', label: 'B', rank: 2 },
    { _id: 'c', label: 'C', rank: 3 }
  ]
  const optimisticValue: Task[] = [
    { _id: 'zero', label: 'Zero', rank: 0 },
    { _id: 'a', label: 'A replaced', rank: 1 },
    { _id: 'between', label: 'Between upserted', rank: 1.5 },
    { _id: 'b', label: 'B updated', rank: 2 },
    { _id: 'd', label: 'D', rank: 4 }
  ]
  let release = noop

  try {
    await client.mutation(api.fixture.setValue, {
      args: { key: 'node-keyed-optimistic', runId, value: initialValue }
    })
    release = client.onUpdate(
      collectionValue,
      { args: { key: 'node-keyed-optimistic', runId } },
      (value) => {
        if (JSON.stringify(value) === JSON.stringify(initialValue)) {
          initial.resolve(value)
        } else if (JSON.stringify(value) === JSON.stringify(optimisticValue)) {
          optimistic.resolve(value)
        }
      }
    )
    await expect(initial.promise).resolves.toEqual(initialValue)

    const mutation = client.mutation(api.fixture.setValue, {
      args: {
        key: 'node-keyed-optimistic',
        runId,
        value: optimisticValue
      },
      optimistic: ({ store }) => {
        const tasks = store.get(collectionValue, {
          key: 'node-keyed-optimistic',
          runId
        })
        tasks.prepend({ _id: 'zero', label: 'Zero', rank: 0 })
        tasks.insert(
          { _id: 'between', label: 'Between', rank: 1.5 },
          { after: 1, keyBy: (task) => task.rank }
        )
        tasks.update('b', { label: 'B updated' })
        tasks.remove('c')
        tasks.replace('a', { _id: 'a', label: 'A replaced', rank: 1 })
        tasks.upsert({
          _id: 'between',
          label: 'Between upserted',
          rank: 1.5
        })
        tasks.upsert({ _id: 'd', label: 'D', rank: 4 })
      }
    })

    await expect(optimistic.promise).resolves.toEqual(optimisticValue)
    await expect(mutation).resolves.toEqual(optimisticValue)
  } finally {
    release()
    await client.mutation(api.fixture.removeRun, { args: { runId } })
    await client.close()
  }
})

it('modifies primitives and merges objects before the deployment responds', async () => {
  const client = new ConvexPulseClient(url)
  const runId = randomUUID()
  const primitiveInitial = deferred<unknown>()
  const primitiveOptimistic = deferred<unknown>()
  const objectInitial = deferred<unknown>()
  const objectOptimistic = deferred<unknown>()
  let releasePrimitive = noop
  let releaseObject = noop

  try {
    await client.mutation(api.fixture.setValue, {
      args: { key: 'node-primitive', runId, value: 'idle' }
    })
    releasePrimitive = client.onUpdate(
      primitiveValue,
      { args: { key: 'node-primitive', runId } },
      (value) => {
        if (value === 'idle') {
          primitiveInitial.resolve(value)
        } else if (value === 'saving') {
          primitiveOptimistic.resolve(value)
        }
      }
    )
    await expect(primitiveInitial.promise).resolves.toBe('idle')

    const primitiveMutation = client.mutation(api.fixture.setValue, {
      args: { key: 'node-primitive', runId, value: 'saved' },
      optimistic: ({ store }) =>
        store
          .get(primitiveValue, { key: 'node-primitive', runId })
          .modify('saving')
    })
    await expect(primitiveOptimistic.promise).resolves.toBe('saving')
    await expect(primitiveMutation).resolves.toBe('saved')

    await client.mutation(api.fixture.setValue, {
      args: {
        key: 'node-object',
        runId,
        value: { count: 1, label: 'server' }
      }
    })
    releaseObject = client.onUpdate(
      objectValue,
      { args: { key: 'node-object', runId } },
      (value) => {
        if (value.count === 1 && value.label === 'server') {
          objectInitial.resolve(value)
        } else if (value.count === 1 && value.label === 'optimistic') {
          objectOptimistic.resolve(value)
        }
      }
    )
    await expect(objectInitial.promise).resolves.toEqual({
      count: 1,
      label: 'server'
    })

    const objectMutation = client.mutation(api.fixture.setValue, {
      args: {
        key: 'node-object',
        runId,
        value: { count: 2, label: 'optimistic' }
      },
      optimistic: ({ store }) =>
        store
          .get(objectValue, { key: 'node-object', runId })
          .merge({ label: 'optimistic' })
    })
    await expect(objectOptimistic.promise).resolves.toEqual({
      count: 1,
      label: 'optimistic'
    })
    await expect(objectMutation).resolves.toEqual({
      count: 2,
      label: 'optimistic'
    })
  } finally {
    releasePrimitive()
    releaseObject()
    await client.mutation(api.fixture.removeRun, { args: { runId } })
    await client.close()
  }
})

it('deduplicates equivalent mutations sent to a real deployment', async () => {
  const tracking = installWebSocketTracking()
  const client = new ConvexPulseClient(url)
  const runId = randomUUID()
  const options = {
    args: { key: 'node-dedupe', runId, value: 'once' },
    dedupe: () => runId
  }

  try {
    const first = client.mutation(api.fixture.setValue, options)
    const second = client.mutation(api.fixture.setValue, options)

    expect(second).toBe(first)
    await expect(Promise.all([first, second])).resolves.toEqual([
      'once',
      'once'
    ])
    expect(countRequest(tracking.frames, 'Mutation')).toBe(1)
    await expect(
      client.query(api.fixture.getValue, {
        args: { key: 'node-dedupe', runId }
      })
    ).resolves.toBe('once')
  } finally {
    await client.mutation(api.fixture.removeRun, { args: { runId } })
    await client.close()
    tracking.restore()
  }
})

it('executes an action with the provided args and returns its result', async () => {
  const client = new ConvexPulseClient(url)
  const value = { source: 'action', value: 23 }

  try {
    await expect(
      client.action(api.fixture.echoAction, {
        args: { value }
      })
    ).resolves.toEqual(value)
  } finally {
    await client.close()
  }
})

it('deduplicates concurrent actions through the public client', async () => {
  const tracking = installWebSocketTracking()
  const client = new ConvexPulseClient(url)
  const value = { source: 'deduplicated action', value: 29 }
  const options = {
    args: { value },
    dedupe: ({ args }: { args: { value: typeof value } }) => args.value
  }

  try {
    const first = client.action(api.fixture.echoAction, options)
    const second = client.action(api.fixture.echoAction, options)

    expect(second).toBe(first)
    await expect(Promise.all([first, second])).resolves.toEqual([value, value])
    expect(countRequest(tracking.frames, 'Action')).toBe(1)
  } finally {
    await client.close()
    tracking.restore()
  }
})

it('reports a Convex query error from a one-shot query', async () => {
  const client = new ConvexPulseClient(url)

  try {
    await expect(
      client.query(api.fixture.throwQueryError, { args: {} })
    ).rejects.toMatchObject({
      message: expect.stringContaining('E2E query error'),
      name: 'SyncQueryError'
    })
  } finally {
    await client.close()
  }
})

it('reports a Convex mutation error without closing the client', async () => {
  const client = new ConvexPulseClient(url)
  const runId = randomUUID()

  try {
    await expect(
      client.mutation(api.fixture.throwMutationError, { args: {} })
    ).rejects.toMatchObject({
      message: expect.stringContaining('E2E mutation error'),
      name: 'SyncMutationError'
    })
    await expect(
      client.mutation(api.fixture.setValue, {
        args: { key: 'after-error', runId, value: 'still open' }
      })
    ).resolves.toBe('still open')
  } finally {
    await client.close()
  }
})

it('reports a Convex action error without closing the client', async () => {
  const client = new ConvexPulseClient(url)

  try {
    await expect(
      client.action(api.fixture.throwActionError, { args: {} })
    ).rejects.toMatchObject({
      message: expect.stringContaining('E2E action error'),
      name: 'SyncActionError'
    })
    await expect(
      client.action(api.fixture.echoAction, {
        args: { value: 'still open' }
      })
    ).resolves.toBe('still open')
  } finally {
    await client.close()
  }
})

it('preserves ConvexError instances and data for every function type', async () => {
  const client = new ConvexPulseClient(url)

  try {
    const queryError = await client
      .query(api.fixture.throwConvexQueryError, { args: {} })
      .catch((error: unknown) => error)
    expect(queryError).toBeInstanceOf(ConvexError)
    expect(queryError).toMatchObject({ data: { code: 'QUERY_FAILED' } })

    const mutationError = await client
      .mutation(api.fixture.throwConvexMutationError, { args: {} })
      .catch((error: unknown) => error)
    expect(mutationError).toBeInstanceOf(ConvexError)
    expect(mutationError).toMatchObject({ data: { code: 'MUTATION_FAILED' } })

    const actionError = await client
      .action(api.fixture.throwConvexActionError, { args: {} })
      .catch((error: unknown) => error)
    expect(actionError).toBeInstanceOf(ConvexError)
    expect(actionError).toMatchObject({ data: { code: 'ACTION_FAILED' } })
  } finally {
    await client.close()
  }
})

it('calls an onUpdate listener with the initial query result', async () => {
  const client = new ConvexPulseClient(url)
  const initial = deferred<unknown>()
  let subscription: ReturnType<typeof client.onUpdate> | null = null

  try {
    subscription = client.onUpdate(
      api.fixture.getValue,
      { args: { key: 'initial', runId: randomUUID() } },
      (value) => {
        initial.resolve(value)
      }
    )

    expect(subscription.getCurrentValue()).toBeUndefined()
    await expect(initial.promise).resolves.toBeNull()
    expect(subscription.getCurrentValue()).toBeNull()
  } finally {
    subscription?.unsubscribe()
    await client.close()
  }
})

it('reports real query failures through subscription error listeners', async () => {
  const client = new ConvexPulseClient(url)
  const receivedError = deferred<Error>()
  const subscription = client.onUpdate(
    api.fixture.throwConvexQueryError,
    { args: {} },
    noop
  )
  const removeErrorListener = subscription.onError((error) => {
    receivedError.resolve(error)
  })

  try {
    await expect(receivedError.promise).resolves.toMatchObject({
      data: { code: 'QUERY_FAILED' }
    })
    expect(() => subscription.getCurrentValue()).toThrow()
  } finally {
    removeErrorListener()
    subscription()
    await client.close()
  }
})

it('calls an onUpdate listener again when the query result changes', async () => {
  const client = new ConvexPulseClient(url)
  const runId = randomUUID()
  const initial = deferred<unknown>()
  const updated = deferred<unknown>()
  let callCount = 0
  let release = noop

  try {
    release = client.onUpdate(
      api.fixture.getValue,
      { args: { key: 'updates', runId } },
      (value) => {
        callCount += 1
        if (callCount === 1) {
          initial.resolve(value)
        } else {
          updated.resolve(value)
        }
      }
    )

    await expect(initial.promise).resolves.toBeNull()
    await client.mutation(api.fixture.setValue, {
      args: { key: 'updates', runId, value: 'changed' }
    })
    await expect(updated.promise).resolves.toBe('changed')
    expect(callCount).toBe(2)
  } finally {
    release()
    await client.close()
  }
})

it('calls an onUpdate listener only when its selected value changes', async () => {
  const client = new ConvexPulseClient(url)
  const runId = randomUUID()
  const initial = deferred<unknown>()
  const updated = deferred<unknown>()
  let callCount = 0
  let release = noop

  try {
    await client.mutation(api.fixture.setValue, {
      args: {
        key: 'selected-updates',
        runId,
        value: { hidden: 1, visible: 'same' }
      }
    })
    release = client.onUpdate(
      api.fixture.getValue,
      {
        args: { key: 'selected-updates', runId },
        select: (value) =>
          isRecord(value) && typeof value.visible === 'string'
            ? value.visible
            : null
      },
      (value) => {
        callCount += 1
        if (callCount === 1) {
          initial.resolve(value)
        } else {
          updated.resolve(value)
        }
      }
    )

    await expect(initial.promise).resolves.toBe('same')
    await client.mutation(api.fixture.setValue, {
      args: {
        key: 'selected-updates',
        runId,
        value: { hidden: 2, visible: 'same' }
      }
    })
    await delay(100)
    expect(callCount).toBe(1)

    await client.mutation(api.fixture.setValue, {
      args: {
        key: 'selected-updates',
        runId,
        value: { hidden: 2, visible: 'changed' }
      }
    })
    await expect(updated.promise).resolves.toBe('changed')
    expect(callCount).toBe(2)
  } finally {
    release()
    await client.mutation(api.fixture.removeRun, { args: { runId } })
    await client.close()
  }
})

it('stops calling an onUpdate listener after its unsubscribe function runs', async () => {
  const client = new ConvexPulseClient(url)
  const runId = randomUUID()
  const initial = deferred<unknown>()
  let callCount = 0
  let release = noop

  try {
    release = client.onUpdate(
      api.fixture.getValue,
      { args: { key: 'unsubscribe', runId } },
      (value) => {
        callCount += 1
        initial.resolve(value)
      }
    )

    await expect(initial.promise).resolves.toBeNull()
    release()
    await client.mutation(api.fixture.setValue, {
      args: { key: 'unsubscribe', runId, value: 'ignored' }
    })
    await delay(50)
    expect(callCount).toBe(1)
  } finally {
    release()
    await client.close()
  }
})

it('streams the initial and subsequent query results through watchQuery', async () => {
  const client = new ConvexPulseClient(url)
  const runId = randomUUID()
  const stream = client.watchQuery(api.fixture.getValue, {
    args: { key: 'stream', runId }
  })
  const iterator = stream[Symbol.asyncIterator]()

  try {
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: null
    })
    const update = iterator.next()
    await client.mutation(api.fixture.setValue, {
      args: { key: 'stream', runId, value: 'next' }
    })
    await expect(update).resolves.toEqual({ done: false, value: 'next' })
  } finally {
    await iterator.return?.()
    await client.close()
  }
})

it('stops a watchQuery subscription when asynchronous iteration ends', async () => {
  const tracking = installWebSocketTracking()
  const client = new ConvexPulseClient(url)
  const stream = client.watchQuery(api.fixture.getValue, {
    args: { key: 'break', runId: randomUUID() }
  })
  let received = 0

  try {
    for await (const value of stream) {
      expect(value).toBeNull()
      received += 1
      if (received === 1) {
        break
      }
    }

    expect(received).toBe(1)
    await expect(stream[Symbol.asyncIterator]().next()).resolves.toEqual({
      done: true,
      value: undefined
    })
    expect(countQueryModification(tracking.frames, 'Remove')).toBe(1)
  } finally {
    await client.close()
    tracking.restore()
  }
})

it('shares one live subscription for equivalent onUpdate and watchQuery calls', async () => {
  const tracking = installWebSocketTracking()
  const client = new ConvexPulseClient(url)
  const runId = randomUUID()
  const listenerValue = deferred<unknown>()
  let release = noop
  let iterator: AsyncIterator<unknown> | null = null

  try {
    release = client.onUpdate(
      api.fixture.getValue,
      { args: { key: 'shared', runId } },
      (value) => {
        listenerValue.resolve(value)
      }
    )
    const stream = client.watchQuery(api.fixture.getValue, {
      args: { key: 'shared', runId }
    })

    iterator = stream[Symbol.asyncIterator]()

    await Promise.all([listenerValue.promise, iterator.next()])
    expect(countQueryModification(tracking.frames, 'Add')).toBe(1)

    release()
    await iterator.return?.()
    expect(countQueryModification(tracking.frames, 'Remove')).toBe(1)
  } finally {
    release()
    await iterator?.return?.()
    await client.close()
    tracking.restore()
  }
})

it('keeps subscriptions live across a recoverable connection loss', async () => {
  const tracking = installWebSocketTracking()
  const reader = new ConvexPulseClient(url)
  const runId = randomUUID()
  const initial = deferred<unknown>()
  const updated = deferred<unknown>()
  let release = noop
  let writer: ConvexPulseClient | null = null

  try {
    release = reader.onUpdate(
      api.fixture.getValue,
      { args: { key: 'reconnect', runId } },
      (value) => {
        if (value === null) {
          initial.resolve(value)
        }
        if (value === 'after reconnect') {
          updated.resolve(value)
        }
      }
    )

    await expect(initial.promise).resolves.toBeNull()
    const socket = await waitForOpenSocket(tracking.sockets, 1)
    const nextConnectionCount = tracking.sockets.length + 1
    socket.close(4000, 'E2E recoverable disconnect')
    await waitForOpenSocket(tracking.sockets, nextConnectionCount)

    tracking.restore()
    writer = new ConvexPulseClient(url)
    await writer.mutation(api.fixture.setValue, {
      args: { key: 'reconnect', runId, value: 'after reconnect' }
    })
    await expect(updated.promise).resolves.toBe('after reconnect')
  } finally {
    release()
    await writer?.close()
    await reader.close()
    tracking.restore()
  }
})

it('preserves Convex values across queries, mutations, actions, and live updates', async () => {
  const client = new ConvexPulseClient(url)
  const runId = randomUUID()
  const first = richValue('first', -9_223_372_036_854_775_808n, 1)
  const second = richValue('second', 9_223_372_036_854_775_807n, 2)
  const initial = deferred<unknown>()
  const updated = deferred<unknown>()
  let release = noop

  try {
    const actionResult = await client.action(api.fixture.echoAction, {
      args: { value: first }
    })
    expectRichValue(actionResult, first)

    const mutationResult = await client.mutation(api.fixture.setValue, {
      args: { key: 'values', runId, value: first }
    })
    expectRichValue(mutationResult, first)

    const queryResult = await client.query(api.fixture.getValue, {
      args: { key: 'values', runId }
    })
    expectRichValue(queryResult, first)

    release = client.onUpdate(
      api.fixture.getValue,
      { args: { key: 'values', runId } },
      (value) => {
        if (isRecord(value) && value.label === 'first') {
          initial.resolve(value)
        }
        if (isRecord(value) && value.label === 'second') {
          updated.resolve(value)
        }
      }
    )
    expectRichValue(await initial.promise, first)

    const secondMutationResult = await client.mutation(api.fixture.setValue, {
      args: { key: 'values', runId, value: second }
    })
    expectRichValue(secondMutationResult, second)
    expectRichValue(await updated.promise, second)
  } finally {
    release()
    await client.close()
  }
})

it('closes active listeners and query streams when the client closes', async () => {
  const reader = new ConvexPulseClient(url)
  const writer = new ConvexPulseClient(url)
  const runId = randomUUID()
  const listenerInitial = deferred<unknown>()
  let listenerCalls = 0
  const release = reader.onUpdate(
    api.fixture.getValue,
    { args: { key: 'close', runId } },
    (value) => {
      listenerCalls += 1
      listenerInitial.resolve(value)
    }
  )
  const stream = reader.watchQuery(api.fixture.getValue, {
    args: { key: 'close', runId }
  })

  const iterator = stream[Symbol.asyncIterator]()

  try {
    await Promise.all([listenerInitial.promise, iterator.next()])
    const pendingUpdate = iterator.next()

    await reader.close()
    await expect(pendingUpdate).resolves.toEqual({
      done: true,
      value: undefined
    })

    await writer.mutation(api.fixture.setValue, {
      args: { key: 'close', runId, value: 'after close' }
    })
    await delay(50)
    expect(listenerCalls).toBe(1)
  } finally {
    release()
    await reader.close()
    await writer.close()
  }
})

it('rejects new operations after the client closes', async () => {
  const client = new ConvexPulseClient(url)
  const args = { key: 'closed', runId: randomUUID() }

  await client.close()

  await expect(client.query(api.fixture.getValue, { args })).rejects.toThrow(
    'Sync client is closed'
  )
  await expect(
    client.mutation(api.fixture.setValue, {
      args: { ...args, value: 'rejected' }
    })
  ).rejects.toThrow('Sync client is closed')
  await expect(
    client.action(api.fixture.echoAction, {
      args: { value: 'rejected' }
    })
  ).rejects.toThrow('Sync client is closed')
  expect(() => {
    client.onUpdate(api.fixture.getValue, { args }, noop)
  }).toThrow('Sync client is closed')
  expect(() => {
    client.watchQuery(api.fixture.getValue, { args })
  }).toThrow('Sync client is closed')
})

const primitiveValue = makeFunctionReference<
  'query',
  { key: string; runId: string },
  string
>('fixture:getValue')
const arrayValue = makeFunctionReference<
  'query',
  { key: string; runId: string },
  unknown[]
>('fixture:getValue')
const collectionValue = makeFunctionReference<
  'query',
  { key: string; runId: string },
  Task[]
>('fixture:getValue')
const objectValue = makeFunctionReference<
  'query',
  { key: string; runId: string },
  { count: number; label: string }
>('fixture:getValue')

type Deferred<Value> = {
  promise: Promise<Value>
  resolve: (value: Value | PromiseLike<Value>) => void
}

type Task = {
  _id: string
  label: string
  rank: number
}

type RichValue = {
  bigint: bigint
  bytes: ArrayBuffer
  infinity: number
  label: string
  nan: number
  negativeInfinity: number
  negativeZero: number
  nested: [null, boolean, string, { count: number }]
}
