import { expect, it } from 'vitest'

import {
  canonicalConvexValue,
  decodeConvexValue,
  encodeConvexValue
} from '#client/valueCodec.js'

it('round trips every Convex scalar representation', () => {
  const bytes = new Uint8Array([0, 1, 2, 255]).buffer
  const value = {
    bigint: -9_223_372_036_854_775_808n,
    bytes,
    infinity: Number.POSITIVE_INFINITY,
    nan: Number.NaN,
    negativeZero: -0,
    regular: 1.5
  }

  const decoded = decodeConvexValue(encodeConvexValue(value)) as typeof value

  expect(decoded.bigint).toBe(value.bigint)
  expect(new Uint8Array(decoded.bytes)).toEqual(new Uint8Array(bytes))
  expect(decoded.infinity).toBe(Number.POSITIVE_INFINITY)
  expect(decoded.nan).toBeNaN()
  expect(Object.is(decoded.negativeZero, -0)).toBe(true)
  expect(decoded.regular).toBe(1.5)
})

it('canonicalizes object keys for query identity', () => {
  const unordered = Object.fromEntries([
    ['b', 2],
    [
      'a',
      Object.fromEntries([
        ['d', 4],
        ['c', 3]
      ])
    ]
  ])
  expect(canonicalConvexValue(unordered)).toBe(
    canonicalConvexValue({ a: { c: 3, d: 4 }, b: 2 })
  )
})

it('rejects unsupported values and reserved object fields', () => {
  expect(() => encodeConvexValue(new Date())).toThrow('not a supported')
  expect(() => encodeConvexValue({ $reserved: true })).toThrow('reserved')
  expect(() => encodeConvexValue(9_223_372_036_854_775_808n)).toThrow(
    'signed 64-bit'
  )
})
