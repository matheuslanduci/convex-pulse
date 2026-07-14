import type { ClientFrame, ServerMessage } from '#client/protocol.js'
import type { SyncConnectionEvent, SyncTransport } from '#client/SyncClient.js'

export class FakeTransport implements SyncTransport {
  readonly #messageListeners = new Set<(message: ServerMessage) => void>()
  readonly #connectionListeners = new Set<
    (event: SyncConnectionEvent) => void
  >()
  readonly frames: ClientFrame[] = []
  closed = false

  send(frame: ClientFrame) {
    if (this.closed) {
      throw new Error('Fake transport is closed')
    }
    this.frames.push(structuredClone(frame))
  }

  subscribe(listener: (message: ServerMessage) => void) {
    this.#messageListeners.add(listener)
    return () => this.#messageListeners.delete(listener)
  }

  subscribeConnection(listener: (event: SyncConnectionEvent) => void) {
    this.#connectionListeners.add(listener)
    return () => this.#connectionListeners.delete(listener)
  }

  connect() {
    this.#emitConnection({ type: 'connected' })
  }

  disconnect(reason = 'network lost') {
    this.#emitConnection({ reason, type: 'disconnected' })
  }

  reconnect() {
    this.#emitConnection({ type: 'reconnected' })
  }

  receive(message: ServerMessage) {
    for (const listener of this.#messageListeners) {
      listener(structuredClone(message))
    }
  }

  close() {
    this.closed = true
    this.#messageListeners.clear()
    this.#connectionListeners.clear()
  }

  #emitConnection(event: SyncConnectionEvent) {
    for (const listener of this.#connectionListeners) {
      listener(event)
    }
  }
}
