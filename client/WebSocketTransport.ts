import {
  decodeServerMessage,
  encodeClientFrame,
  TransitionAssembler
} from '#client/protocol.js'
import type {
  ClientFrame,
  ServerMessage,
  WireServerMessage
} from '#client/protocol.js'
import type { SyncConnectionEvent, SyncTransport } from '#client/SyncClient.js'

export class WebSocketTransport implements SyncTransport {
  readonly #connectionListeners = new Set<
    (event: SyncConnectionEvent) => void
  >()
  readonly #messageListeners = new Set<(message: ServerMessage) => void>()
  readonly #assembler: TransitionAssembler
  readonly #onError: (error: unknown) => void
  readonly #reconnectDelay: (attempt: number) => number
  readonly #setTimer: (callback: () => void, delay: number) => unknown
  readonly #clearTimer: (timer: unknown) => void
  readonly #socketFactory: (url: string) => WebSocket
  readonly #url: string
  #closed = false
  #connectionCount = 0
  #reconnectAttempt = 0
  #reconnectTimer: unknown | null = null
  #socket: WebSocket | null = null

  constructor(deploymentUrl: string, options: WebSocketTransportOptions = {}) {
    this.#url = WebSocketTransport.#syncUrl(
      deploymentUrl,
      options.protocolVersion ?? '1.42.1'
    )
    this.#socketFactory =
      options.webSocketFactory ?? WebSocketTransport.#createWebSocket
    this.#onError = options.onError ?? WebSocketTransport.#ignoreError
    this.#reconnectDelay =
      options.reconnectDelay ?? WebSocketTransport.#defaultReconnectDelay
    this.#setTimer = options.setTimer ?? WebSocketTransport.#defaultSetTimer
    this.#clearTimer =
      options.clearTimer ?? WebSocketTransport.#clearReconnectTimer
    this.#assembler = new TransitionAssembler({
      limits: options.chunkLimits ?? {
        deadlineMs: 30_000,
        maxBytes: 16 * 1024 * 1024,
        maxParts: 1024
      },
      monotonicNow: options.monotonicNow ?? performance.now.bind(performance)
    })
    this.#connect()
  }

  send(frame: ClientFrame) {
    if (this.#closed) {
      throw new Error('WebSocket transport is closed')
    }
    if (this.#socket?.readyState !== 1) {
      throw new Error('WebSocket transport is not connected')
    }
    this.#socket.send(JSON.stringify(encodeClientFrame(frame)))
  }

  subscribe(listener: (message: ServerMessage) => void) {
    this.#messageListeners.add(listener)
    return () => this.#messageListeners.delete(listener)
  }

  subscribeConnection(listener: (event: SyncConnectionEvent) => void) {
    this.#connectionListeners.add(listener)
    return () => this.#connectionListeners.delete(listener)
  }

  close() {
    if (this.#closed) {
      return
    }
    this.#closed = true
    if (this.#reconnectTimer !== null) {
      this.#clearTimer(this.#reconnectTimer)
      this.#reconnectTimer = null
    }
    this.#assembler.reset()
    this.#messageListeners.clear()
    this.#connectionListeners.clear()
    const socket = this.#socket
    this.#socket = null
    socket?.close(1000, 'Client closed')
  }

  #connect() {
    if (this.#closed) {
      return
    }
    let socket: WebSocket
    try {
      socket = this.#socketFactory(this.#url)
    } catch (error) {
      this.#report(error)
      this.#scheduleReconnect()
      return
    }
    this.#socket = socket

    socket.addEventListener('open', () => {
      if (this.#closed || socket !== this.#socket) {
        return
      }
      this.#reconnectAttempt = 0
      this.#emitConnection({
        type: this.#connectionCount === 0 ? 'connected' : 'reconnected'
      })
      this.#connectionCount += 1
    })

    socket.addEventListener('message', (event) => {
      if (this.#closed || socket !== this.#socket) {
        return
      }
      try {
        const parsed = JSON.parse(String(event.data)) as unknown
        const decoded = decodeServerMessage(parsed)
        this.#receive(decoded)
      } catch (error) {
        this.#report(error)
      }
    })

    socket.addEventListener('error', (event) => {
      this.#report(event)
    })

    socket.addEventListener('close', (event) => {
      if (this.#closed || socket !== this.#socket) {
        return
      }
      this.#socket = null
      this.#assembler.reset()
      this.#emitConnection({
        reason: WebSocketTransport.#closeReason(event),
        type: 'disconnected'
      })
      this.#scheduleReconnect()
    })
  }

  #receive(message: WireServerMessage) {
    if (message.type === 'TransitionChunk') {
      const transition = this.#assembler.push(message)
      if (transition !== null) {
        this.#publish(transition)
      }
      return
    }
    this.#publish(message)
  }

  #publish(message: ServerMessage) {
    for (const listener of this.#messageListeners) {
      try {
        listener(message)
      } catch (error) {
        this.#report(error)
      }
    }
  }

  #emitConnection(event: SyncConnectionEvent) {
    for (const listener of this.#connectionListeners) {
      try {
        listener(event)
      } catch (error) {
        this.#report(error)
      }
    }
  }

  #scheduleReconnect() {
    if (this.#closed || this.#reconnectTimer !== null) {
      return
    }
    const delay = this.#reconnectDelay(this.#reconnectAttempt)
    this.#reconnectAttempt += 1
    this.#reconnectTimer = this.#setTimer(() => {
      this.#reconnectTimer = null
      this.#connect()
    }, delay)
  }

  #report(error: unknown) {
    try {
      this.#onError(error)
    } catch {
      // Diagnostics cannot interrupt transport progress.
    }
  }

  static #syncUrl(deploymentUrl: string, protocolVersion: string) {
    const url = new URL(deploymentUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new TypeError('Convex deployment URL must use HTTP or HTTPS')
    }
    url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:'
    url.pathname = `/api/${encodeURIComponent(protocolVersion)}/sync`
    url.search = ''
    url.hash = ''
    return url.toString()
  }

  static #closeReason(event: CloseEvent) {
    return event.reason || `code ${event.code}`
  }

  static #createWebSocket(url: string) {
    return new WebSocket(url)
  }

  static #ignoreError(error: unknown) {
    void error
  }

  static #defaultReconnectDelay(attempt: number) {
    return Math.min(250 * 2 ** attempt, 10_000)
  }

  static #defaultSetTimer(callback: () => void, delay: number) {
    return globalThis.setTimeout(callback, delay)
  }

  static #clearReconnectTimer(timer: unknown) {
    clearTimeout(timer as ReturnType<typeof setTimeout>)
  }
}

export type WebSocketTransportOptions = Readonly<{
  chunkLimits?: Readonly<{
    deadlineMs: number
    maxBytes: number
    maxParts: number
  }>
  clearTimer?: (timer: unknown) => void
  monotonicNow?: () => number
  onError?: (error: unknown) => void
  protocolVersion?: string
  reconnectDelay?: (attempt: number) => number
  setTimer?: (callback: () => void, delay: number) => unknown
  webSocketFactory?: (url: string) => WebSocket
}>
