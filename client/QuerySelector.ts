import type { CoreQueryHandle, CoreQuerySnapshot } from '#client/QueryCore.js'
import type { SyncQueryResult } from '#client/SyncClient.js'

export function selectQueryHandle<Data, Selected>(
  source: CoreQueryHandle<Data>,
  select: (data: Data) => Selected
): CoreQueryHandle<Selected> {
  let snapshot = selectSnapshot(source.getSnapshot(), select)

  function update() {
    const next = selectSnapshot(source.getSnapshot(), select, snapshot)
    if (next === snapshot) {
      return false
    }
    snapshot = next
    return true
  }

  function subscribe(listener: () => void) {
    update()
    return source.subscribe(() => {
      if (update()) {
        listener()
      }
    })
  }

  function subscribeWithCurrent(listener: () => void) {
    update()
    let subscribing = true
    const release = source.subscribeWithCurrent(() => {
      if (update() || (subscribing && snapshot.status !== 'pending')) {
        listener()
      }
    })
    subscribing = false
    return release
  }

  return {
    getCacheGeneration: source.getCacheGeneration,
    getResult: () => {
      update()
      return snapshotResult(snapshot)
    },
    getSnapshot: () => {
      update()
      return snapshot
    },
    subscribe,
    subscribeWithCurrent
  }
}

function selectSnapshot<Data, Selected>(
  source: CoreQuerySnapshot<Data>,
  select: (data: Data) => Selected,
  previous?: CoreQuerySnapshot<Selected>
): CoreQuerySnapshot<Selected> {
  if (source.status !== 'success') {
    if (
      previous?.status === source.status &&
      (source.status === 'pending' || previous.error === source.error)
    ) {
      return previous
    }
    return source
  }

  try {
    const selected = select(source.data)
    if (previous?.status === 'success') {
      const shared = structurallyShare(previous.data, selected)
      if (shared === previous.data) {
        return previous
      }
      return {
        data: shared,
        error: null,
        isLoading: false,
        status: 'success'
      }
    }
    return {
      data: selected,
      error: null,
      isLoading: false,
      status: 'success'
    }
  } catch (error) {
    const selectedError = toError(error)
    if (
      previous?.status === 'error' &&
      previous.error.name === selectedError.name &&
      previous.error.message === selectedError.message
    ) {
      return previous
    }
    return {
      data: undefined,
      error: selectedError,
      isLoading: false,
      status: 'error'
    }
  }
}

function structurallyShare<Selected>(
  previous: Selected,
  next: Selected
): Selected {
  if (Object.is(previous, next)) {
    return previous
  }
  if (Array.isArray(previous) && Array.isArray(next)) {
    if (previous.length !== next.length) {
      return next
    }
    const shared = next.map((value, index) =>
      structurallyShare(previous[index], value)
    )
    return shared.every((value, index) => Object.is(value, previous[index]))
      ? previous
      : (shared as Selected)
  }
  if (isPlainObject(previous) && isPlainObject(next)) {
    const previousKeys = Object.keys(previous)
    const nextKeys = Object.keys(next)
    if (previousKeys.length !== nextKeys.length) {
      return next
    }
    const shared: Record<string, unknown> = {}
    for (const key of nextKeys) {
      if (!(key in previous)) {
        return next
      }
      shared[key] = structurallyShare(previous[key], next[key])
    }
    return nextKeys.every((key) => Object.is(shared[key], previous[key]))
      ? previous
      : (shared as Selected)
  }
  if (previous instanceof ArrayBuffer && next instanceof ArrayBuffer) {
    const left = new Uint8Array(previous)
    const right = new Uint8Array(next)
    if (
      left.byteLength === right.byteLength &&
      left.every((value, index) => value === right[index])
    ) {
      return previous
    }
  }
  return next
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === null || prototype === Object.prototype
}

function snapshotResult(
  snapshot: CoreQuerySnapshot<unknown>
): SyncQueryResult | null {
  if (snapshot.status === 'success') {
    return { status: 'success', value: snapshot.data }
  }
  if (snapshot.status === 'error') {
    return { error: snapshot.error, status: 'error' }
  }
  return null
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}
