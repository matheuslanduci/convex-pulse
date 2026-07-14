import { expect, it, vi } from 'vitest'

import { SyncQueryStream } from '#node/SyncQueryStream.js'

function setupStream<Data>() {
  let receive!: (result: QueryResult) => void
  const release = vi.fn()
  const onClose = vi.fn()
  const stream = new SyncQueryStream<Data>((next) => {
    receive = next
    return release
  }, onClose)

  return { onClose, receive, release, stream }
}

it('is its own async iterator and yields queued values', async () => {
  const { receive, stream } = setupStream<string>()

  expect(stream[Symbol.asyncIterator]()).toBe(stream)
  receive({ status: 'success', value: 'first' })
  receive({ status: 'success', value: 'second' })

  await expect(stream.next()).resolves.toEqual({ done: false, value: 'first' })
  await expect(stream.next()).resolves.toEqual({ done: false, value: 'second' })
})

it('delivers a value to a pending iteration', async () => {
  const { receive, stream } = setupStream<string>()
  const next = stream.next()

  receive({ status: 'success', value: 'ready' })

  await expect(next).resolves.toEqual({ done: false, value: 'ready' })
})

it('rejects a second concurrent iteration', async () => {
  const { receive, stream } = setupStream<string>()
  const first = stream.next()

  await expect(stream.next()).rejects.toThrow(
    'Only one watchQuery iteration may be pending'
  )
  receive({ status: 'success', value: 'ready' })
  await first
})

it('return closes the stream and resolves a pending iteration', async () => {
  const { onClose, release, stream } = setupStream<string>()
  const next = stream.next()

  await expect(stream.return()).resolves.toEqual({
    done: true,
    value: undefined
  })
  await expect(next).resolves.toEqual({ done: true, value: undefined })
  await expect(stream.next()).resolves.toEqual({ done: true, value: undefined })
  expect(release).toHaveBeenCalledOnce()
  expect(onClose).toHaveBeenCalledWith(stream)

  stream.close()
  expect(release).toHaveBeenCalledOnce()
})

it('rejects a pending iteration when the subscription errors', async () => {
  const { onClose, receive, release, stream } = setupStream<string>()
  const next = stream.next()
  const error = new Error('subscription failed')

  receive({ error, status: 'error' })

  await expect(next).rejects.toBe(error)
  expect(release).toHaveBeenCalledOnce()
  expect(onClose).toHaveBeenCalledWith(stream)
})

it('stores an error until the next iteration and only reports it once', async () => {
  const { receive, stream } = setupStream<string>()
  const error = new Error('subscription failed')

  receive({ error, status: 'error' })

  await expect(stream.next()).rejects.toBe(error)
  await expect(stream.next()).resolves.toEqual({ done: true, value: undefined })
})

it('ignores results received after close', async () => {
  const { receive, stream } = setupStream<string>()

  stream.close(new Error('closed'))
  receive({ status: 'success', value: 'ignored' })

  await expect(stream.next()).rejects.toThrow('closed')
  await expect(stream.next()).resolves.toEqual({ done: true, value: undefined })
})

type QueryResult =
  | { status: 'success'; value: unknown }
  | { error: Error; status: 'error' }
