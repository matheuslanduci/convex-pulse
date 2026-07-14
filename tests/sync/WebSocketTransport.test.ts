import { expect, it, vi } from 'vitest'

import { WebSocketTransport } from '#client/WebSocketTransport.js'

class FakeSocket extends EventTarget {
  readonly sent: string[] = []
  readyState = 0
  url = ''

  send(frame: string) {
    this.sent.push(frame)
  }

  close() {
    this.readyState = 3
  }

  open() {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }

  message(data: string) {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }

  disconnect() {
    this.readyState = 3
    const event = new Event('close')
    Object.defineProperties(event, {
      code: { value: 1006 },
      reason: { value: 'network lost' }
    })
    this.dispatchEvent(event)
  }
}

function reconnectImmediately() {
  return 0
}

function clearTimer(timer: unknown) {
  expect(timer).toBeDefined()
}

it('opens the Convex sync endpoint and exchanges decoded frames', () => {
  const socket = new FakeSocket()
  const transport = new WebSocketTransport('http://127.0.0.1:3210', {
    webSocketFactory: function webSocketFactory(url) {
      socket.url = url
      return socket as unknown as WebSocket
    }
  })
  const connected = vi.fn()
  const received = vi.fn()
  transport.subscribeConnection(connected)
  transport.subscribe(received)

  socket.open()
  transport.send({
    clientTs: 1,
    connectionCount: 0,
    lastCloseReason: null,
    sessionId: 'session',
    type: 'Connect'
  })
  socket.message('{"type":"Ping"}')

  expect(socket.url).toBe('ws://127.0.0.1:3210/api/1.42.1/sync')
  expect(JSON.parse(socket.sent[0] as string)).toMatchObject({
    sessionId: 'session',
    type: 'Connect'
  })
  expect(connected).toHaveBeenCalledWith({ type: 'connected' })
  expect(received).toHaveBeenCalledWith({ type: 'Ping' })
  transport.close()
})

it('reconnects after a recoverable close', () => {
  const sockets: FakeSocket[] = []
  const timers: (() => void)[] = []
  const transport = new WebSocketTransport('https://example.com', {
    clearTimer,
    reconnectDelay: reconnectImmediately,
    setTimer: function setTimer(callback) {
      timers.push(callback)
      return callback
    },
    webSocketFactory: function webSocketFactory() {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    }
  })
  const events: string[] = []
  transport.subscribeConnection((event) => {
    events.push(event.type)
  })

  sockets[0]?.open()
  sockets[0]?.disconnect()
  timers[0]?.()
  sockets[1]?.open()

  expect(events).toEqual(['connected', 'disconnected', 'reconnected'])
  transport.close()
})

it('calls the default browser timer with the global receiver', () => {
  const socket = new FakeSocket()
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
  const transport = new WebSocketTransport('https://example.com', {
    webSocketFactory: function webSocketFactory() {
      return socket as unknown as WebSocket
    }
  })

  socket.open()
  socket.disconnect()

  expect(setTimer).toHaveBeenCalledOnce()
  transport.close()
  setTimer.mockRestore()
})
