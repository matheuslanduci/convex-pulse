export class FakeWebSocket extends EventTarget {
  static readonly instances: FakeWebSocket[] = []
  readonly sent: Record<string, unknown>[] = []
  readonly url: string
  readyState = 0
  #querySet = 0
  #timestamp = 0
  #identity = 0

  constructor(url: string) {
    super()
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>)
  }

  close() {
    this.readyState = 3
  }

  async connected() {
    if (this.readyState === 0) {
      this.readyState = 1
      this.dispatchEvent(new Event('open'))
      await Promise.resolve()
    }
  }

  succeed(value: unknown, queryId = 0) {
    return this.#receive({
      journal: null,
      queryId,
      type: 'QueryUpdated',
      value
    })
  }

  fail(errorMessage: string, queryId = 0) {
    return this.#receive({
      errorMessage,
      journal: null,
      queryId,
      type: 'QueryFailed'
    })
  }

  querySetFrames() {
    return this.sent.filter((frame) => frame.type === 'ModifyQuerySet')
  }

  removeFrames() {
    return this.querySetFrames().filter((frame) =>
      (frame.modifications as Record<string, unknown>[]).some(
        (modification) => modification.type === 'Remove'
      )
    )
  }

  mutationFrames() {
    return this.sent.filter((frame) => frame.type === 'Mutation')
  }

  actionFrames() {
    return this.sent.filter((frame) => frame.type === 'Action')
  }

  authenticateFrames() {
    return this.sent.filter((frame) => frame.type === 'Authenticate')
  }

  async confirmAuth() {
    const identity = this.#identity + 1

    await this.#receive([], identity)
  }

  async resolveMutation(result: unknown, queryValue?: unknown, index = -1) {
    await this.connected()
    const mutation = this.mutationFrames().at(index)
    if (typeof mutation?.requestId !== 'number') {
      throw new TypeError('Expected a pending mutation')
    }
    const timestamp = this.#timestamp + 1
    this.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          requestId: mutation.requestId,
          result,
          success: true,
          ts: FakeWebSocket.#encodeTimestamp(timestamp),
          type: 'MutationResponse'
        })
      })
    )
    await this.#receive(
      queryValue === undefined
        ? []
        : [
            {
              journal: null,
              queryId: 0,
              type: 'QueryUpdated',
              value: queryValue
            }
          ]
    )
  }

  async rejectMutation(errorMessage: string, index = -1) {
    await this.connected()
    const mutation = this.mutationFrames().at(index)
    if (typeof mutation?.requestId !== 'number') {
      throw new TypeError('Expected a pending mutation')
    }
    this.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          errorData: null,
          requestId: mutation.requestId,
          result: errorMessage,
          success: false,
          type: 'MutationResponse'
        })
      })
    )
    await Promise.resolve()
  }

  async resolveAction(result: unknown, index = -1) {
    await this.connected()
    const action = this.actionFrames().at(index)
    if (typeof action?.requestId !== 'number') {
      throw new TypeError('Expected a pending action')
    }
    this.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          requestId: action.requestId,
          result,
          success: true,
          type: 'ActionResponse'
        })
      })
    )
    await Promise.resolve()
  }

  async rejectAction(errorMessage: string, index = -1) {
    await this.connected()
    const action = this.actionFrames().at(index)
    if (typeof action?.requestId !== 'number') {
      throw new TypeError('Expected a pending action')
    }
    this.dispatchEvent(
      new MessageEvent('message', {
        data: JSON.stringify({
          errorData: null,
          requestId: action.requestId,
          result: errorMessage,
          success: false,
          type: 'ActionResponse'
        })
      })
    )
    await Promise.resolve()
  }

  async #receive(
    modification: Record<string, unknown> | Record<string, unknown>[],
    identity = this.#identity
  ) {
    await this.connected()
    const startVersion = FakeWebSocket.#version(
      this.#identity,
      this.#querySet,
      this.#timestamp
    )
    this.#querySet = this.#latestQuerySet()
    this.#timestamp += 1
    this.#identity = identity
    const message = new MessageEvent('message', {
      data: JSON.stringify({
        endVersion: FakeWebSocket.#version(
          this.#identity,
          this.#querySet,
          this.#timestamp
        ),
        modifications: Array.isArray(modification)
          ? modification
          : [modification],
        startVersion,
        type: 'Transition'
      })
    })
    this.dispatchEvent(message)
  }

  #latestQuerySet() {
    const last = this.querySetFrames().at(-1)
    return typeof last?.newVersion === 'number'
      ? last.newVersion
      : this.#querySet
  }

  static #version(identity: number, querySet: number, timestamp: number) {
    return {
      identity,
      querySet,
      ts: FakeWebSocket.#encodeTimestamp(timestamp)
    }
  }

  static #encodeTimestamp(timestamp: number) {
    const bytes = new Uint8Array(8)
    bytes[0] = timestamp
    return btoa(String.fromCodePoint(...bytes))
  }
}
