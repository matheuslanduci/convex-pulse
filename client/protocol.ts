import { SyncProtocolError } from '#client/errors.js'
import { decodeConvexValue } from '#client/valueCodec.js'

const maximumU64 = 18_446_744_073_709_551_615n

export function stateVersionsEqual(left: StateVersion, right: StateVersion) {
  return (
    left.identity === right.identity &&
    left.querySet === right.querySet &&
    left.ts === right.ts
  )
}

export function zeroStateVersion(): StateVersion {
  return {
    identity: 0,
    querySet: 0,
    ts: 0n
  }
}

export function encodeU64(value: bigint) {
  if (value < 0n || value > maximumU64) {
    throw new SyncProtocolError('Timestamp is outside the u64 range')
  }
  const bytes = new Uint8Array(8)
  let remaining = value
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number(remaining % 256n)
    remaining /= 256n
  }
  return bytesToBase64(bytes)
}

export function decodeU64(value: unknown) {
  if (typeof value !== 'string') {
    throw new SyncProtocolError('Timestamp must be base64')
  }
  const bytes = base64ToBytes(value)
  if (bytes.length !== 8 || bytesToBase64(bytes) !== value) {
    throw new SyncProtocolError(
      'Timestamp must contain exactly 8 canonical bytes'
    )
  }
  let result = 0n
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    result = result * 256n + BigInt(bytes[index] as number)
  }
  return result
}

export function encodeClientFrame(frame: ClientFrame): unknown {
  if (frame.type !== 'Connect' || frame.maxObservedTimestamp === undefined) {
    return frame
  }
  return {
    ...frame,
    maxObservedTimestamp: encodeU64(frame.maxObservedTimestamp)
  }
}

export function decodeServerMessage(value: unknown): WireServerMessage {
  const frame = requireRecord(value, 'Server message')
  const type = requireString(frame.type, 'Server message type')

  if (type === 'Ping') {
    return { type }
  }
  if (type === 'FatalError') {
    return { error: requireString(frame.error, 'FatalError.error'), type }
  }
  if (type === 'AuthError') {
    return {
      authUpdateAttempted: requireBoolean(
        frame.authUpdateAttempted,
        'AuthError.authUpdateAttempted'
      ),
      baseVersion: requireInteger(frame.baseVersion, 'AuthError.baseVersion'),
      error: requireString(frame.error, 'AuthError.error'),
      type
    }
  }
  if (type === 'TransitionChunk') {
    return decodeTransitionChunk(frame)
  }
  if (type === 'Transition') {
    return decodeTransition(frame)
  }
  if (type === 'ActionResponse') {
    return decodeActionResponse(frame)
  }
  if (type === 'MutationResponse') {
    return decodeMutationResponse(frame)
  }
  throw new SyncProtocolError(`Unsupported server message: ${type}`)
}

function decodeActionResponse(frame: Record<string, unknown>): ActionResponse {
  const requestId = requireInteger(frame.requestId, 'ActionResponse.requestId')
  if (frame.success === true) {
    return {
      requestId,
      result: decodeConvexValue(frame.result),
      success: true,
      type: 'ActionResponse'
    }
  }
  if (frame.success !== false) {
    throw new SyncProtocolError('ActionResponse.success must be a boolean')
  }
  return {
    ...(frame.errorData === undefined
      ? {}
      : { errorData: decodeConvexValue(frame.errorData) }),
    requestId,
    result: requireString(frame.result, 'ActionResponse.result'),
    success: false,
    type: 'ActionResponse'
  }
}

export class TransitionAssembler {
  readonly #limits: TransitionChunkLimits
  readonly #now: () => number
  #assembly: TransitionAssembly | null = null

  constructor(options: TransitionAssemblerOptions) {
    this.#limits = options.limits
    this.#now = options.monotonicNow
  }

  push(chunk: TransitionChunk): Transition | null {
    const now = this.#now()
    if (
      this.#assembly !== null &&
      now - this.#assembly.startedAt > this.#limits.deadlineMs
    ) {
      this.#assembly = null
      throw new SyncProtocolError('Transition chunk assembly expired')
    }
    if (chunk.totalParts > this.#limits.maxParts) {
      throw new SyncProtocolError('Transition has too many chunks')
    }
    if (this.#assembly === null) {
      if (chunk.partNumber !== 0) {
        throw new SyncProtocolError('First transition chunk must be part 0')
      }
      this.#assembly = {
        chunks: [],
        id: chunk.transitionId,
        size: 0,
        startedAt: now,
        totalParts: chunk.totalParts
      }
    }

    const assembly = this.#assembly
    if (
      assembly.id !== chunk.transitionId ||
      assembly.totalParts !== chunk.totalParts ||
      chunk.partNumber !== assembly.chunks.length
    ) {
      this.#assembly = null
      throw new SyncProtocolError(
        'Transition chunks are interleaved or out of order'
      )
    }
    assembly.size += new TextEncoder().encode(chunk.chunk).byteLength
    if (assembly.size > this.#limits.maxBytes) {
      this.#assembly = null
      throw new SyncProtocolError('Transition exceeds the inbound byte limit')
    }
    assembly.chunks.push(chunk.chunk)
    if (assembly.chunks.length !== assembly.totalParts) {
      return null
    }

    this.#assembly = null
    let parsed: unknown
    try {
      parsed = JSON.parse(assembly.chunks.join('')) as unknown
    } catch (error) {
      throw new SyncProtocolError('Assembled transition is not valid JSON', {
        cause: error
      })
    }
    const message = decodeServerMessage(parsed)
    if (message.type !== 'Transition') {
      throw new SyncProtocolError('Chunks must assemble to a Transition')
    }
    return message
  }

  reset() {
    this.#assembly = null
  }
}

function decodeTransition(frame: Record<string, unknown>): Transition {
  return {
    endVersion: decodeStateVersion(frame.endVersion, 'Transition.endVersion'),
    modifications: requireArray(
      frame.modifications,
      'Transition.modifications'
    ).map(decodeStateModification),
    startVersion: decodeStateVersion(
      frame.startVersion,
      'Transition.startVersion'
    ),
    type: 'Transition'
  }
}

function decodeStateModification(value: unknown): StateModification {
  const modification = requireRecord(value, 'Transition modification')
  const type = requireString(modification.type, 'Modification.type')
  const queryId = requireInteger(modification.queryId, 'Modification.queryId')
  if (type === 'QueryRemoved') {
    return { queryId, type }
  }
  const { journal } = modification
  if (journal !== null && typeof journal !== 'string') {
    throw new SyncProtocolError('Modification.journal must be a string or null')
  }
  if (type === 'QueryUpdated') {
    return {
      journal,
      queryId,
      type,
      value: decodeConvexValue(modification.value)
    }
  }
  if (type === 'QueryFailed') {
    return {
      ...(modification.errorData === undefined
        ? {}
        : { errorData: decodeConvexValue(modification.errorData) }),
      errorMessage: requireString(
        modification.errorMessage,
        'QueryFailed.errorMessage'
      ),
      journal,
      queryId,
      type
    }
  }
  throw new SyncProtocolError(`Unsupported query modification: ${type}`)
}

function decodeStateVersion(value: unknown, label: string): StateVersion {
  const version = requireRecord(value, label)
  return {
    identity: requireInteger(version.identity, `${label}.identity`),
    querySet: requireInteger(version.querySet, `${label}.querySet`),
    ts: decodeU64(version.ts)
  }
}

function decodeMutationResponse(
  frame: Record<string, unknown>
): MutationResponse {
  const requestId = requireInteger(
    frame.requestId,
    'MutationResponse.requestId'
  )
  if (frame.success === true) {
    return {
      requestId,
      result: decodeConvexValue(frame.result),
      success: true,
      ts: decodeU64(frame.ts),
      type: 'MutationResponse'
    }
  }
  if (frame.success !== false) {
    throw new SyncProtocolError('MutationResponse.success must be a boolean')
  }
  return {
    ...(frame.errorData === undefined
      ? {}
      : { errorData: decodeConvexValue(frame.errorData) }),
    requestId,
    result: requireString(frame.result, 'MutationResponse.result'),
    success: false,
    type: 'MutationResponse'
  }
}

function decodeTransitionChunk(
  frame: Record<string, unknown>
): TransitionChunk {
  const totalParts = requireInteger(
    frame.totalParts,
    'TransitionChunk.totalParts'
  )
  const partNumber = requireInteger(
    frame.partNumber,
    'TransitionChunk.partNumber'
  )
  if (totalParts < 1 || partNumber >= totalParts) {
    throw new SyncProtocolError('Transition chunk bounds are invalid')
  }
  return {
    chunk: requireString(frame.chunk, 'TransitionChunk.chunk'),
    partNumber,
    totalParts,
    transitionId: requireString(
      frame.transitionId,
      'TransitionChunk.transitionId'
    ),
    type: 'TransitionChunk'
  }
}

function requireRecord(value: unknown, label: string) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SyncProtocolError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireArray(value: unknown, label: string) {
  if (!Array.isArray(value)) {
    throw new SyncProtocolError(`${label} must be an array`)
  }
  return value
}

function requireString(value: unknown, label: string) {
  if (typeof value !== 'string') {
    throw new SyncProtocolError(`${label} must be a string`)
  }
  return value
}

function requireInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new SyncProtocolError(`${label} must be a nonnegative safe integer`)
  }
  return value as number
}

function requireBoolean(value: unknown, label: string) {
  if (typeof value !== 'boolean') {
    throw new SyncProtocolError(`${label} must be a boolean`)
  }
  return value
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
    throw new SyncProtocolError('Invalid base64', { cause: error })
  }
  return Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0)
}

export type ClientFrame =
  | ConnectFrame
  | AuthenticateFrame
  | ModifyQuerySetFrame
  | MutationFrame
  | ActionFrame

export type ConnectFrame = Readonly<{
  clientTs: number
  connectionCount: number
  lastCloseReason: string | null
  maxObservedTimestamp?: bigint
  sessionId: string
  type: 'Connect'
}>

export type AuthenticateFrame =
  | Readonly<{
      baseVersion: number
      tokenType: 'User'
      type: 'Authenticate'
      value: string
    }>
  | Readonly<{
      baseVersion: number
      tokenType: 'None'
      type: 'Authenticate'
    }>

export type ModifyQuerySetFrame = Readonly<{
  baseVersion: number
  modifications: readonly QuerySetModification[]
  newVersion: number
  type: 'ModifyQuerySet'
}>

export type MutationFrame = Readonly<{
  args: readonly [unknown]
  requestId: number
  type: 'Mutation'
  udfPath: string
}>

export type ActionFrame = Readonly<{
  args: readonly [unknown]
  requestId: number
  type: 'Action'
  udfPath: string
}>

export type QuerySetModification = AddQuery | RemoveQuery

export type AddQuery = Readonly<{
  args: readonly [unknown]
  journal: string | null
  queryId: number
  type: 'Add'
  udfPath: string
}>

export type RemoveQuery = Readonly<{
  queryId: number
  type: 'Remove'
}>

export type ServerMessage =
  | Transition
  | MutationResponse
  | ActionResponse
  | AuthError
  | FatalError
  | Ping

export type WireServerMessage = ServerMessage | TransitionChunk

export type Transition = Readonly<{
  endVersion: StateVersion
  modifications: readonly StateModification[]
  startVersion: StateVersion
  type: 'Transition'
}>

export type StateVersion = Readonly<{
  identity: number
  querySet: number
  ts: bigint
}>

export type StateModification = QueryUpdated | QueryFailed | QueryRemoved

export type QueryUpdated = Readonly<{
  journal: string | null
  queryId: number
  type: 'QueryUpdated'
  value: unknown
}>

export type QueryFailed = Readonly<{
  errorData?: unknown
  errorMessage: string
  journal: string | null
  queryId: number
  type: 'QueryFailed'
}>

export type QueryRemoved = Readonly<{
  queryId: number
  type: 'QueryRemoved'
}>

export type MutationResponse = MutationSuccess | MutationFailure

export type MutationSuccess = Readonly<{
  requestId: number
  result: unknown
  success: true
  ts: bigint
  type: 'MutationResponse'
}>

export type MutationFailure = Readonly<{
  errorData?: unknown
  requestId: number
  result: string
  success: false
  type: 'MutationResponse'
}>

export type ActionResponse = ActionSuccess | ActionFailure

export type ActionSuccess = Readonly<{
  requestId: number
  result: unknown
  success: true
  type: 'ActionResponse'
}>

export type ActionFailure = Readonly<{
  errorData?: unknown
  requestId: number
  result: string
  success: false
  type: 'ActionResponse'
}>

export type FatalError = Readonly<{
  error: string
  type: 'FatalError'
}>

export type AuthError = Readonly<{
  authUpdateAttempted: boolean
  baseVersion: number
  error: string
  type: 'AuthError'
}>

export type Ping = Readonly<{
  type: 'Ping'
}>

export type TransitionChunk = Readonly<{
  chunk: string
  partNumber: number
  totalParts: number
  transitionId: string
  type: 'TransitionChunk'
}>

export type TransitionChunkLimits = Readonly<{
  deadlineMs: number
  maxBytes: number
  maxParts: number
}>

export type TransitionAssemblerOptions = Readonly<{
  limits: TransitionChunkLimits
  monotonicNow: () => number
}>

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- Repository convention requires type aliases.
type TransitionAssembly = {
  chunks: string[]
  id: string
  size: number
  startedAt: number
  totalParts: number
}
