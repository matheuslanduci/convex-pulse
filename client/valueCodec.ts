const minimumInt64 = -9_223_372_036_854_775_808n
const maximumInt64 = 9_223_372_036_854_775_807n
const maximumFieldNameLength = 1024

export function encodeConvexValue(value: unknown): JsonValue {
  return encodeValue(value, '')
}

export function decodeConvexValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(decodeConvexValue)
  }

  if (!isRecord(value)) {
    throw new TypeError('Invalid Convex value')
  }

  const entries = Object.entries(value)
  if (entries.length === 1) {
    if ('$integer' in value) {
      const bytes = decodeSpecialBytes(value.$integer, '$integer')
      if (bytes.byteLength !== 8) {
        throw new TypeError('$integer must contain exactly 8 bytes')
      }
      return new DataView(bytes.buffer).getBigInt64(0, true)
    }

    if ('$float' in value) {
      const bytes = decodeSpecialBytes(value.$float, '$float')
      if (bytes.byteLength !== 8) {
        throw new TypeError('$float must contain exactly 8 bytes')
      }
      const number = new DataView(bytes.buffer).getFloat64(0, true)
      if (!isSpecialNumber(number)) {
        throw new TypeError('$float must encode a special number')
      }
      return number
    }

    if ('$bytes' in value) {
      return decodeSpecialBytes(value.$bytes, '$bytes').buffer
    }
  }

  const decoded: Record<string, unknown> = {}
  for (const [key, child] of entries) {
    validateFieldName(key)
    decoded[key] = decodeConvexValue(child)
  }
  return decoded
}

export function canonicalConvexValue(value: unknown): string {
  return JSON.stringify(encodeConvexValue(value))
}

function encodeValue(value: unknown, path: string): JsonValue {
  if (value === undefined) {
    throw new TypeError(
      `undefined is not a valid Convex value at ${path || '<root>'}`
    )
  }

  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return value
  }

  if (typeof value === 'bigint') {
    if (value < minimumInt64 || value > maximumInt64) {
      throw new TypeError(
        `BigInt ${value} does not fit in a signed 64-bit integer`
      )
    }
    const bytes = new Uint8Array(8)
    new DataView(bytes.buffer).setBigInt64(0, value, true)
    return { $integer: bytesToBase64(bytes) }
  }

  if (typeof value === 'number') {
    if (!isSpecialNumber(value)) {
      return value
    }
    const bytes = new Uint8Array(8)
    new DataView(bytes.buffer).setFloat64(0, value, true)
    return { $float: bytesToBase64(bytes) }
  }

  if (value instanceof ArrayBuffer) {
    return { $bytes: bytesToBase64(new Uint8Array(value)) }
  }

  if (Array.isArray(value)) {
    return value.map((child, index) => encodeValue(child, `${path}[${index}]`))
  }

  if (!isPlainObject(value)) {
    throw new TypeError(`${String(value)} is not a supported Convex value`)
  }

  const encoded: Record<string, JsonValue> = {}
  for (const [key, child] of Object.entries(value).toSorted(([left], [right]) =>
    left.localeCompare(right)
  )) {
    validateFieldName(key)
    if (child !== undefined) {
      encoded[key] = encodeValue(child, `${path}.${key}`)
    }
  }
  return encoded
}

function isSpecialNumber(value: number) {
  return Number.isNaN(value) || !Number.isFinite(value) || Object.is(value, -0)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === null || prototype === Object.prototype
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateFieldName(key: string) {
  if (key.length > maximumFieldNameLength) {
    throw new TypeError(
      `Convex field name exceeds ${maximumFieldNameLength} characters`
    )
  }
  if (key.startsWith('$')) {
    throw new TypeError(`Convex field name ${key} uses the reserved '$' prefix`)
  }
  for (const character of key) {
    const code = character.codePointAt(0) as number
    if (code < 32 || code >= 127) {
      throw new TypeError(
        `Convex field name ${key} contains an invalid character`
      )
    }
  }
}

function decodeSpecialBytes(value: unknown, label: string) {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be base64`)
  }
  return base64ToBytes(value)
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte)
  }
  return btoa(binary)
}

function base64ToBytes(value: string) {
  let binary: string
  try {
    binary = atob(value)
  } catch (error) {
    throw new TypeError('Invalid base64', { cause: error })
  }
  return Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0)
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | JsonObject

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- Repository convention requires type aliases.
type JsonObject = {
  readonly [key: string]: JsonValue
}
