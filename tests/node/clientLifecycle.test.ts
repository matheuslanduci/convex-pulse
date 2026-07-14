import { ConvexPulseClient } from 'convex-pulse'
import { makeFunctionReference } from 'convex/server'
import type { FunctionReference } from 'convex/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { FakeWebSocket } from '#testkit/FakeWebSocket.js'

beforeEach(() => {
  FakeWebSocket.instances.length = 0
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function setup() {
  const client = new ConvexPulseClient('https://example.convex.cloud')
  const [socket] = FakeWebSocket.instances

  if (!socket) {
    throw new Error('Expected the client to create a WebSocket')
  }

  return { client, socket }
}

it('resolves one-shot queries and removes their subscriptions', async () => {
  const { client, socket } = setup()
  const result = client.query(valueQuery, { args: { id: 'one' } })

  await socket.succeed('value')

  await expect(result).resolves.toBe('value')
  expect(socket.removeFrames()).toHaveLength(1)
  await client.close()
})

it('rejects failed one-shot queries', async () => {
  const { client, socket } = setup()
  const result = client.query(valueQuery, { args: { id: 'one' } })

  await socket.fail('query failed')

  await expect(result).rejects.toThrow('query failed')
  await client.close()
})

it('retries one-shot queries and resolves a later attempt', async () => {
  const { client, socket } = setup()
  const result = client.query(valueQuery, {
    args: { id: 'one' },
    retries: 1
  })

  await socket.fail('first')
  expect(socket.querySetFrames()).toHaveLength(3)
  await socket.succeed('value', 1)

  await expect(result).resolves.toBe('value')
  expect(socket.removeFrames()).toHaveLength(2)
  await client.close()
})

it('rejects pending and future queries when closed', async () => {
  const { client } = setup()
  const pending = client.query(valueQuery, { args: { id: 'one' } })

  await client.close()

  await expect(pending).rejects.toThrow('Sync client is closed')
  await expect(
    client.query(valueQuery, { args: { id: 'two' } })
  ).rejects.toThrow('Sync client is closed')
  await expect(client.close()).resolves.toBeUndefined()
})

it('forwards auth configuration and clearAuth to the sync client', async () => {
  const { client, socket } = setup()
  const onChange = vi.fn()

  client.setAuth(() => Promise.resolve('token'), { onChange })
  await socket.connected()
  await vi.waitFor(() => expect(socket.authenticateFrames()).toHaveLength(1))
  await socket.confirmAuth()

  client.clearAuth()
  await vi.waitFor(() => expect(socket.authenticateFrames()).toHaveLength(2))
  await client.close()
})

it('fetches a token from the Node client options', async () => {
  const fetchToken = vi.fn(() => Promise.resolve('options-token'))
  const client = new ConvexPulseClient('https://example.convex.cloud', {
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
    value: 'options-token'
  })
  await client.close()
})

it('executes actions and encodes their arguments', async () => {
  const { client, socket } = setup()
  const result = client.action(actionReference, {
    args: { count: 7n, missing: Number.NaN }
  })

  await socket.connected()
  const frame = socket.sent.find((candidate) => candidate.type === 'Action')
  expect(frame).toMatchObject({ udfPath: 'tasks:run' })
  expect(frame?.args).toEqual([
    {
      count: { $integer: 'BwAAAAAAAAA=' },
      missing: { $float: 'AAAAAAAA+H8=' }
    }
  ])
  socket.dispatchEvent(
    new MessageEvent('message', {
      data: JSON.stringify({
        requestId: frame?.requestId,
        result: 'done',
        success: true,
        type: 'ActionResponse'
      })
    })
  )

  await expect(result).resolves.toBe('done')
  await client.close()
})

it('retries actions and rejects the final error after exhaustion', async () => {
  const { client, socket } = setup()
  const result = client.action(actionReference, {
    args: { count: 1n, missing: 0 },
    retries: 1
  })

  await socket.rejectAction('first')
  await vi.waitFor(() => expect(socket.actionFrames()).toHaveLength(2))
  await socket.rejectAction('final')

  await expect(result).rejects.toThrow('final')
  expect(socket.actionFrames()).toHaveLength(2)
  await client.close()
})

it('shares query subscriptions, replays results, and releases once', async () => {
  const { client, socket } = setup()
  const first = vi.fn()
  const second = vi.fn()
  const releaseFirst = client.onUpdate(
    valueQuery,
    { args: { id: 'one' } },
    first
  )

  await socket.succeed('initial')
  const releaseSecond = client.onUpdate(
    valueQuery,
    { args: { id: 'one' } },
    second
  )

  expect(first).toHaveBeenCalledWith('initial')
  expect(second).toHaveBeenCalledWith('initial')
  expect(socket.querySetFrames()).toHaveLength(1)

  releaseFirst()
  releaseFirst()
  expect(socket.removeFrames()).toHaveLength(0)
  releaseSecond()
  expect(socket.removeFrames()).toHaveLength(1)
  await client.close()
})

it('shares a query subscription before its first result', async () => {
  const { client, socket } = setup()
  const first = vi.fn()
  const second = vi.fn()
  const releaseFirst = client.onUpdate(
    valueQuery,
    { args: { id: 'one' } },
    first
  )
  const releaseSecond = client.onUpdate(
    valueQuery,
    { args: { id: 'one' } },
    second
  )

  expect(first).not.toHaveBeenCalled()
  expect(second).not.toHaveBeenCalled()
  await socket.succeed('initial')
  expect(first).toHaveBeenCalledWith('initial')
  expect(second).toHaveBeenCalledWith('initial')

  releaseFirst()
  releaseSecond()
  await client.close()
})

it('exposes the current onUpdate value and a named unsubscribe method', async () => {
  const { client, socket } = setup()
  const listener = vi.fn()
  const subscription = client.onUpdate(
    valueQuery,
    { args: { id: 'one' } },
    listener
  )

  expect(subscription.getCurrentValue()).toBeUndefined()
  await socket.succeed('current')
  expect(subscription.getCurrentValue()).toBe('current')
  expect(listener).toHaveBeenCalledWith('current')

  subscription.unsubscribe()
  expect(socket.removeFrames()).toHaveLength(1)
  await client.close()
})

it('reports onUpdate errors through subscription error listeners', async () => {
  const { client, socket } = setup()
  const listener = vi.fn()
  const firstErrorListener = vi.fn()
  const secondErrorListener = vi.fn()
  const subscription = client.onUpdate(
    valueQuery,
    { args: { id: 'one' } },
    listener
  )

  await socket.fail('query failed')
  const removeFirstErrorListener = subscription.onError(firstErrorListener)
  subscription.onError(secondErrorListener)

  expect(listener).not.toHaveBeenCalled()
  expect(firstErrorListener).toHaveBeenCalledWith(expect.any(Error))
  expect(firstErrorListener.mock.calls[0]?.[0]).toHaveProperty(
    'message',
    'query failed'
  )
  expect(secondErrorListener).toHaveBeenCalledTimes(1)
  expect(() => subscription.getCurrentValue()).toThrow('query failed')

  removeFirstErrorListener()
  await socket.succeed('recovered')
  await socket.fail('failed again')
  expect(firstErrorListener).toHaveBeenCalledTimes(1)
  expect(secondErrorListener).toHaveBeenCalledTimes(2)

  subscription()
  await client.close()
})

it('closes live query streams and subscriptions with the client', async () => {
  const { client, socket } = setup()
  const stream = client.watchQuery(valueQuery, { args: { id: 'one' } })
  const next = stream[Symbol.asyncIterator]().next()

  await client.close()

  await expect(next).resolves.toEqual({ done: true, value: undefined })
  expect(socket.readyState).toBe(3)
})

it('settles an optimistic mutation after close has cleared query entries', async () => {
  const { client, socket } = setup()
  const mutation = client.mutation(addTask, {
    args: { value: 'later' },
    optimistic: ({ data, store }) => store.get(taskList).append(data.value)
  })

  await socket.connected()
  const close = client.close()

  await expect(mutation).rejects.toThrow('Sync client is closed')
  await close
})

it('applies one optimistic layer across multiple query keys', async () => {
  const { client, socket } = setup()
  const firstValues: string[][] = []
  const secondValues: string[][] = []
  client.onUpdate(taskList, { args: {} }, (value) => firstValues.push(value))
  client.onUpdate(otherTaskList, { args: {} }, (value) =>
    secondValues.push(value)
  )
  await socket.succeed([])

  const mutation = client.mutation(addTask, {
    args: { value: 'both' },
    optimistic: ({ data, store }) => {
      store.get(taskList).append(data.value)
      store.get(otherTaskList).append(data.value)
    }
  })

  expect(firstValues.at(-1)).toEqual(['both'])
  expect(secondValues).toEqual([])
  await socket.resolveMutation('both')
  await mutation
  await client.close()
})

it('keeps an optimistic query silent until a server result exists', async () => {
  const { client, socket } = setup()
  const listener = vi.fn()
  client.onUpdate(taskList, { args: {} }, listener)

  const mutation = client.mutation(addTask, {
    args: { value: 'later' },
    optimistic: ({ data, store }) => store.get(taskList).append(data.value)
  })

  expect(listener).not.toHaveBeenCalled()
  await socket.resolveMutation('later')
  await mutation
  await client.close()
})

it('rejects invalid function references for every operation', async () => {
  const { client } = setup()
  const invalidQuery = {} as FunctionReference<
    'query',
    'public',
    Record<string, never>,
    unknown
  >
  const invalidMutation = {} as FunctionReference<
    'mutation',
    'public',
    Record<string, never>,
    unknown
  >
  const invalidAction = {} as FunctionReference<
    'action',
    'public',
    Record<string, never>,
    unknown
  >

  expect(() => client.query(invalidQuery, { args: {} })).toThrow(
    '[object Object] is not a functionReference'
  )
  expect(() => client.mutation(invalidMutation, { args: {} })).toThrow(
    '[object Object] is not a functionReference'
  )
  expect(() => client.action(invalidAction, { args: {} })).toThrow(
    '[object Object] is not a functionReference'
  )
  await client.close()
})

const valueQuery = makeFunctionReference<'query', { id: string }, string>(
  'tasks:value'
)
const actionReference = makeFunctionReference<
  'action',
  { count: bigint; missing: number },
  string
>('tasks:run')
const taskList = makeFunctionReference<
  'query',
  Record<string, never>,
  string[]
>('tasks:list')
const otherTaskList = makeFunctionReference<
  'query',
  Record<string, never>,
  string[]
>('otherTasks:list')
const addTask = makeFunctionReference<'mutation', { value: string }, string>(
  'tasks:add'
)
