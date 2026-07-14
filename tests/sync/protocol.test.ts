import { expect, it } from 'vitest'

import {
  decodeServerMessage,
  decodeU64,
  encodeClientFrame,
  encodeU64,
  TransitionAssembler
} from '#client/protocol.js'

function monotonicNow() {
  return 0
}

it('encodes unsigned timestamps as eight little-endian bytes', () => {
  expect(encodeU64(0n)).toBe('AAAAAAAAAAA=')
  expect(encodeU64(2n)).toBe('AgAAAAAAAAA=')
  expect(decodeU64('//////////8=')).toBe(18_446_744_073_709_551_615n)
  expect(() => decodeU64('AA==')).toThrow('exactly 8')
})

it('decodes query transitions and Convex values', () => {
  expect(
    decodeServerMessage({
      endVersion: { identity: 0, querySet: 1, ts: 'AQAAAAAAAAA=' },
      modifications: [
        {
          journal: 'opaque',
          logLines: [],
          queryId: 0,
          type: 'QueryUpdated',
          value: { $integer: 'KgAAAAAAAAA=' }
        }
      ],
      startVersion: { identity: 0, querySet: 0, ts: 'AAAAAAAAAAA=' },
      type: 'Transition'
    })
  ).toEqual({
    endVersion: { identity: 0, querySet: 1, ts: 1n },
    modifications: [
      { journal: 'opaque', queryId: 0, type: 'QueryUpdated', value: 42n }
    ],
    startVersion: { identity: 0, querySet: 0, ts: 0n },
    type: 'Transition'
  })
})

it('decodes successful and failed action responses', () => {
  expect(
    decodeServerMessage({
      logLines: [],
      requestId: 3,
      result: { $integer: 'KgAAAAAAAAA=' },
      success: true,
      type: 'ActionResponse'
    })
  ).toEqual({
    requestId: 3,
    result: 42n,
    success: true,
    type: 'ActionResponse'
  })
  expect(
    decodeServerMessage({
      errorData: { code: 'FAILED' },
      logLines: [],
      requestId: 4,
      result: 'action failed',
      success: false,
      type: 'ActionResponse'
    })
  ).toEqual({
    errorData: { code: 'FAILED' },
    requestId: 4,
    result: 'action failed',
    success: false,
    type: 'ActionResponse'
  })
})

it('decodes authentication errors', () => {
  expect(
    decodeServerMessage({
      authUpdateAttempted: true,
      baseVersion: 2,
      error: 'token rejected',
      type: 'AuthError'
    })
  ).toEqual({
    authUpdateAttempted: true,
    baseVersion: 2,
    error: 'token rejected',
    type: 'AuthError'
  })
})

it('assembles chunked transitions in order', () => {
  const encoded = JSON.stringify({
    endVersion: { identity: 0, querySet: 0, ts: 'AAAAAAAAAAA=' },
    modifications: [],
    startVersion: { identity: 0, querySet: 0, ts: 'AAAAAAAAAAA=' },
    type: 'Transition'
  })
  const split = Math.floor(encoded.length / 2)
  const assembler = new TransitionAssembler({
    limits: { deadlineMs: 100, maxBytes: 1000, maxParts: 2 },
    monotonicNow
  })

  expect(
    assembler.push({
      chunk: encoded.slice(0, split),
      partNumber: 0,
      totalParts: 2,
      transitionId: 'transition',
      type: 'TransitionChunk'
    })
  ).toBeNull()
  expect(
    assembler.push({
      chunk: encoded.slice(split),
      partNumber: 1,
      totalParts: 2,
      transitionId: 'transition',
      type: 'TransitionChunk'
    })
  ).toMatchObject({ type: 'Transition' })
})

it('encodes the connection timestamp before JSON serialization', () => {
  expect(
    encodeClientFrame({
      clientTs: 1,
      connectionCount: 0,
      lastCloseReason: null,
      maxObservedTimestamp: 2n,
      sessionId: 'session',
      type: 'Connect'
    })
  ).toMatchObject({ maxObservedTimestamp: 'AgAAAAAAAAA=' })
})
