import type { SyncQueryResult } from '#client/SyncClient.js'

export class SyncQueryStream<Data>
  implements AsyncIterable<Data>, AsyncIterator<Data>
{
  readonly #onClose: (stream: SyncQueryStream<Data>) => void
  readonly #queue: Data[] = []
  readonly #release: () => void
  #closed = false
  #error: Error | null = null
  #waiter: StreamWaiter<Data> | null = null

  constructor(
    subscribe: (receive: (result: SyncQueryResult) => void) => () => void,
    onClose: (stream: SyncQueryStream<Data>) => void
  ) {
    this.#onClose = onClose
    this.#release = subscribe(this.#receive.bind(this))
  }

  [Symbol.asyncIterator]() {
    return this
  }

  next(): Promise<IteratorResult<Data>> {
    if (this.#queue.length > 0) {
      return Promise.resolve({
        done: false,
        value: this.#queue.shift() as Data
      })
    }
    if (this.#error !== null) {
      const error = this.#error
      this.#error = null
      return Promise.reject(error)
    }
    if (this.#closed) {
      return Promise.resolve({ done: true, value: undefined })
    }
    if (this.#waiter !== null) {
      return Promise.reject(
        new Error('Only one watchQuery iteration may be pending')
      )
    }

    return new Promise<IteratorResult<Data>>((resolve, reject) => {
      this.#waiter = { reject, resolve }
    })
  }

  return(): Promise<IteratorResult<Data>> {
    this.close()
    return Promise.resolve({ done: true, value: undefined })
  }

  close(error?: Error) {
    if (this.#closed) {
      return
    }
    this.#closed = true
    this.#release()
    const waiter = this.#waiter
    this.#waiter = null
    if (error === undefined) {
      waiter?.resolve({ done: true, value: undefined })
    } else if (waiter === null) {
      this.#error = error
    } else {
      waiter.reject(error)
    }
    this.#onClose(this)
  }

  #receive(result: SyncQueryResult) {
    if (this.#closed) {
      return
    }
    if (result.status === 'error') {
      this.close(result.error)
      return
    }
    const value = result.value as Data
    const waiter = this.#waiter
    if (waiter === null) {
      this.#queue.push(value)
      return
    }
    this.#waiter = null
    waiter.resolve({ done: false, value })
  }
}

type StreamWaiter<Data> = {
  reject: (error: Error) => void
  resolve: (result: IteratorResult<Data>) => void
}
