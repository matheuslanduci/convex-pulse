import { ConvexError } from 'convex/values'
import type { Value } from 'convex/values'

/* eslint-disable max-classes-per-file -- The sync error family is one public contract. */

export function functionError(error: Error, data: unknown) {
  if (data === undefined) {
    return error
  }

  const convexError = new ConvexError<Value>(error.message)
  convexError.data = data as Value
  return convexError
}

export class SyncProtocolError extends Error {
  override readonly name = 'SyncProtocolError'
}

export class SyncClientClosedError extends Error {
  override readonly name = 'SyncClientClosedError'

  constructor() {
    super('Sync client is closed')
  }
}

export class SyncQueryError extends Error {
  override readonly name = 'SyncQueryError'
  readonly data: unknown

  constructor(message: string, data: unknown) {
    super(message)
    this.data = data
  }
}

export class SyncMutationError extends Error {
  override readonly name = 'SyncMutationError'
  readonly data: unknown

  constructor(message: string, data: unknown) {
    super(message)
    this.data = data
  }
}

export class SyncActionError extends Error {
  override readonly name = 'SyncActionError'
  readonly data: unknown

  constructor(message: string, data: unknown) {
    super(message)
    this.data = data
  }
}

export class SyncAuthError extends Error {
  override readonly name = 'SyncAuthError'
}
