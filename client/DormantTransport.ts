import type { ClientFrame, ServerMessage } from '#client/protocol.js'
import type { SyncConnectionEvent, SyncTransport } from '#client/SyncClient.js'

/* eslint-disable class-methods-use-this -- SyncTransport requires instance methods even when the SSR transport has no state. */
/** A no-I/O transport used while framework components render on a server. */
export class DormantTransport implements SyncTransport {
  send(_frame: ClientFrame) {
    throw new Error('The dormant server-render transport cannot send frames')
  }

  subscribe(_listener: (message: ServerMessage) => void) {
    return DormantTransport.#release
  }

  subscribeConnection(_listener: (event: SyncConnectionEvent) => void) {
    return DormantTransport.#release
  }

  close() {
    // The dormant transport has no resources to release.
  }

  static #release() {
    // The dormant transport does not retain listeners.
  }
}
