import { validateRetries } from '#client/retries.js'
import type { SyncQueryResult } from '#client/SyncClient.js'
import {
  canonicalConvexValue,
  decodeConvexValue,
  encodeConvexValue
} from '#client/valueCodec.js'

const defaultGcTime = 5 * 60 * 1000

export class QueryCore {
  readonly #driver: QueryDriver
  readonly #clearTimer: (timer: unknown) => void
  readonly #deduplicatedMutations = new Map<string, DeduplicatedMutation>()
  readonly #devtoolsListeners = new Set<() => void>()
  readonly #gcTime: number
  readonly #now: () => number
  readonly #optimisticLayers: OptimisticLayer[] = []
  readonly #optimisticLayersByRequestId = new Map<number, OptimisticLayer>()
  readonly #optimisticEventHistory: CoreDevtoolsOptimisticEvent[] = []
  readonly #pendingNotifications = new Set<QueryEntry>()
  readonly #queries = new Map<string, QueryEntry>()
  readonly #releaseMutationTransitions: () => void
  readonly #setTimer: (callback: () => void, delay: number) => unknown
  #cacheGeneration = 0
  #isMutationTransitionActive = false

  constructor(driver: QueryDriver, options: QueryCoreOptions = {}) {
    this.#driver = driver
    this.#clearTimer = options.clearTimer ?? QueryCore.#defaultClearTimer
    this.#gcTime = options.gcTime ?? defaultGcTime
    this.#now = options.now ?? Date.now
    this.#setTimer = options.setTimer ?? QueryCore.#defaultSetTimer

    if (Number.isNaN(this.#gcTime) || this.#gcTime < 0) {
      throw new RangeError('gcTime must be a non-negative number')
    }

    this.#releaseMutationTransitions = driver.subscribeMutationTransitions({
      begin: (requestIds) => this.#beginMutationTransition(requestIds),
      end: () => this.#endMutationTransition()
    })
  }

  prepareQuery<Data>(
    path: string,
    args: Readonly<Record<string, unknown>>,
    retries?: number
  ): CoreQueryHandle<Data> {
    const entry = this.#queryEntry(path, args, retries)
    return entry.handle as CoreQueryHandle<Data>
  }

  getDevtoolsSnapshot(): CoreDevtoolsSnapshot {
    return {
      deduplicatedMutations: [...this.#deduplicatedMutations.entries()].map(
        ([key, mutation]) => ({
          callerCount: mutation.callerCount,
          key,
          path: mutation.path,
          requestId: mutation.requestId
        })
      ),
      optimisticEvents: this.#optimisticEventHistory,
      optimisticLayers: this.#optimisticLayers.map((layer, index) => ({
        args: layer.args,
        index,
        operations: layer.operations.map((operation) => {
          const entry = this.#queries.get(operation.key)
          return {
            args:
              entry === undefined
                ? {}
                : (decodeConvexValue(entry.descriptor.args) as Readonly<
                    Record<string, unknown>
                  >),
            hasCustomKeySelector:
              'keyBy' in operation && operation.keyBy !== undefined,
            path: entry?.descriptor.path ?? operation.key,
            position: operation.type === 'insert' ? operation.position : null,
            target:
              operation.type === 'remove' ||
              operation.type === 'replace' ||
              operation.type === 'update'
                ? operation.target
                : undefined,
            type: operation.type,
            value: 'value' in operation ? operation.value : undefined
          }
        }),
        path: layer.path,
        requestId: layer.requestId,
        startedAt: layer.startedAt
      })),
      queries: [...this.#queries.values()]
        .map((entry) => ({
          args: decodeConvexValue(entry.descriptor.args) as Readonly<
            Record<string, unknown>
          >,
          data:
            entry.snapshot.status === 'success'
              ? entry.snapshot.data
              : undefined,
          error:
            entry.snapshot.status === 'error' ? entry.snapshot.error : null,
          expiresAt: entry.expiresAt,
          gcTime: this.#gcTime,
          key: entry.descriptor.key,
          optimisticLayerCount: this.#optimisticLayers.filter((layer) =>
            layer.operations.some(
              (operation) => operation.key === entry.descriptor.key
            )
          ).length,
          path: entry.descriptor.path,
          serverData:
            entry.serverSnapshot.status === 'success'
              ? entry.serverSnapshot.data
              : undefined,
          status: entry.snapshot.status,
          subscriberCount: entry.listeners.size,
          updatedAt: entry.updatedAt
        }))
        .toSorted((left, right) => left.key.localeCompare(right.key))
    }
  }

  subscribeDevtools(listener: () => void) {
    this.#devtoolsListeners.add(listener)
    return () => this.#devtoolsListeners.delete(listener)
  }

  mutation<Data>(
    path: string,
    args: Readonly<Record<string, unknown>>,
    dedupeValue?: unknown,
    optimistic?: (context: CoreOptimisticContext) => void,
    retries?: number
  ): Promise<Data> {
    const retryCount = validateRetries(retries)
    const dedupeKey =
      dedupeValue === undefined
        ? undefined
        : JSON.stringify([path, dedupeValue])
    if (dedupeKey !== undefined) {
      const pending = this.#deduplicatedMutations.get(dedupeKey)
      if (pending !== undefined) {
        pending.callerCount += 1
        this.#notifyDevtools()
        return pending.promise as Promise<Data>
      }
    }

    const layer =
      optimistic === undefined
        ? null
        : this.#applyOptimisticUpdate(path, args, optimistic)
    let request: MutationRequest
    try {
      request = this.#startMutation(path, args, layer)
    } catch (error) {
      if (layer !== null) {
        this.#removeOptimisticLayer(layer, 'rolled-back')
      }
      throw error
    }
    const promise = this.#settleMutation(
      this.#retryMutation<Data>(path, args, layer, retryCount, request),
      layer
    )

    if (dedupeKey !== undefined) {
      this.#deduplicatedMutations.set(dedupeKey, {
        callerCount: 1,
        path,
        promise,
        requestId: request.requestId
      })
      this.#notifyDevtools()
      void this.#releaseDeduplicatedMutation(dedupeKey, promise)
    }

    return promise
  }

  resetAuthScope() {
    this.#cacheGeneration += 1
    this.#deduplicatedMutations.clear()
    for (const layer of this.#optimisticLayers) {
      this.#recordOptimisticEvent(layer, 'auth-removed')
    }
    this.#optimisticLayers.length = 0
    this.#optimisticLayersByRequestId.clear()

    for (const entry of this.#queries.values()) {
      entry.result = null
      entry.serverSnapshot = pendingQuerySnapshot
      entry.snapshot = pendingQuerySnapshot
      entry.updatedAt = null
      if (entry.listeners.size === 0) {
        this.#cancelGc(entry)
        this.#queries.delete(entry.descriptor.key)
        continue
      }
      this.#recompute(entry)
    }
    this.#notifyDevtools()
  }

  close() {
    this.#releaseMutationTransitions()
    for (const entry of this.#queries.values()) {
      entry.release?.()
      entry.release = null
      entry.listeners.clear()
      this.#cancelGc(entry)
    }
    this.#queries.clear()
    this.#optimisticLayersByRequestId.clear()
    this.#pendingNotifications.clear()
    this.#notifyDevtools()
    this.#devtoolsListeners.clear()
  }

  #queryEntry(
    path: string,
    args: Readonly<Record<string, unknown>>,
    retries?: number
  ) {
    const retryCount = validateRetries(retries)
    const key = JSON.stringify([path, canonicalConvexValue(args)])
    let entry = this.#queries.get(key)
    if (entry !== undefined) {
      entry.retries = Math.max(entry.retries, retryCount)
      return entry
    }

    entry = {
      descriptor: {
        args: QueryCore.#encodedArgs(args),
        key,
        path
      },
      expiresAt: null,
      gcTimer: null,
      handle: null,
      listeners: new Set(),
      release: null,
      result: null,
      retries: retryCount,
      serverSnapshot: pendingQuerySnapshot,
      snapshot: pendingQuerySnapshot,
      updatedAt: null
    }
    const createdEntry = entry
    entry.handle = {
      getCacheGeneration: () => this.#cacheGeneration,
      getResult: () => this.#currentEntry(createdEntry).result,
      getSnapshot: () => this.#currentEntry(createdEntry).snapshot,
      subscribe: (listener) =>
        this.#subscribe(this.#activateEntry(createdEntry), listener),
      subscribeWithCurrent: (listener) => {
        const currentEntry = this.#activateEntry(createdEntry)
        const wasActive = currentEntry.release !== null
        const release = this.#subscribe(currentEntry, listener)
        if (wasActive && currentEntry.snapshot.status !== 'pending') {
          listener()
        }
        return release
      }
    }
    this.#queries.set(key, entry)
    this.#scheduleGc(entry)
    return entry
  }

  #subscribe(entry: QueryEntry, listener: () => void) {
    this.#cancelGc(entry)
    entry.listeners.add(listener)
    if (entry.release === null) {
      this.#startQuery(entry)
    }
    this.#notifyDevtools()

    let active = true
    return () => {
      if (!active) {
        return
      }
      active = false
      entry.listeners.delete(listener)
      if (entry.listeners.size === 0) {
        entry.release?.()
        entry.release = null
        this.#scheduleGc(entry)
      } else {
        this.#notifyDevtools()
      }
    }
  }

  #startQuery(entry: QueryEntry) {
    this.#startQueryWithRemaining(entry, entry.retries)
  }

  #startQueryWithRemaining(entry: QueryEntry, remaining: number) {
    let retriesRemaining = remaining
    entry.release = this.#driver.subscribe(entry.descriptor, (result) => {
      if (result.status === 'error' && retriesRemaining > 0) {
        entry.release?.()
        entry.release = null
        entry.serverSnapshot = pendingQuerySnapshot
        entry.updatedAt = null
        this.#recompute(entry)
        if (entry.listeners.size > 0) {
          this.#startQueryWithRemaining(entry, retriesRemaining - 1)
        }
        return
      }
      if (result.status === 'success') {
        retriesRemaining = entry.retries
      }
      entry.serverSnapshot =
        result.status === 'success'
          ? {
              data: result.value,
              error: null,
              isLoading: false,
              status: 'success'
            }
          : {
              data: undefined,
              error: result.error,
              isLoading: false,
              status: 'error'
            }
      entry.updatedAt = this.#now()
      if (result.status === 'success') {
        for (const layer of this.#optimisticLayers) {
          if (
            layer.operations.some(
              (operation) => operation.key === entry.descriptor.key
            )
          ) {
            this.#recordOptimisticEvent(
              layer,
              'replayed',
              entry.descriptor.path
            )
          }
        }
      }
      this.#recompute(entry)
    })
  }

  #currentEntry(entry: QueryEntry) {
    return this.#queries.get(entry.descriptor.key) ?? entry
  }

  #activateEntry(entry: QueryEntry) {
    const current = this.#queries.get(entry.descriptor.key)
    if (current !== undefined) {
      return current
    }

    this.#queries.set(entry.descriptor.key, entry)
    this.#scheduleGc(entry)
    return entry
  }

  #scheduleGc(entry: QueryEntry) {
    this.#cancelGc(entry)
    if (this.#gcTime === Number.POSITIVE_INFINITY) {
      this.#notifyDevtools()
      return
    }

    const expiresAt = this.#now() + this.#gcTime
    entry.expiresAt = expiresAt
    entry.gcTimer = this.#setTimer(() => {
      this.#garbageCollect(entry, expiresAt)
    }, this.#gcTime)
    this.#notifyDevtools()
  }

  #cancelGc(entry: QueryEntry) {
    if (entry.gcTimer !== null) {
      this.#clearTimer(entry.gcTimer)
      entry.gcTimer = null
    }
    entry.expiresAt = null
  }

  #garbageCollect(entry: QueryEntry, expiresAt: number) {
    if (
      this.#queries.get(entry.descriptor.key) !== entry ||
      entry.listeners.size !== 0 ||
      entry.expiresAt !== expiresAt
    ) {
      return
    }

    entry.gcTimer = null
    entry.expiresAt = null
    entry.result = null
    entry.serverSnapshot = pendingQuerySnapshot
    entry.snapshot = pendingQuerySnapshot
    entry.updatedAt = null
    this.#queries.delete(entry.descriptor.key)
    this.#notifyDevtools()
  }

  #applyOptimisticUpdate(
    path: string,
    args: Readonly<Record<string, unknown>>,
    optimistic: (context: CoreOptimisticContext) => void
  ) {
    const operations: OptimisticOperation[] = []
    const store = {
      get: (
        queryPath: string,
        queryArgs: Readonly<Record<string, unknown>>
      ) => {
        const entry = this.#queryEntry(queryPath, queryArgs)
        return QueryCore.#optimisticQuery(entry, operations)
      },
      paginated: (
        queryPath: string,
        queryArgs: Readonly<Record<string, unknown>>
      ) => {
        const entries = this.#paginatedEntries(queryPath, queryArgs)
        const queries = entries.map((entry) => ({
          entry,
          query: QueryCore.#optimisticQuery(entry, operations, 'page')
        }))
        return {
          appendIfLoaded: (value: unknown) => {
            const last = queries.find(({ entry }) => {
              const { snapshot } = entry
              return (
                snapshot.status === 'success' &&
                QueryCore.#isRecord(snapshot.data) &&
                snapshot.data.isDone === true
              )
            })
            last?.query.append(value)
          },
          prepend: (value: unknown) => {
            const first = queries.find(({ entry }) => {
              const pagination = QueryCore.#paginationOptions(entry)
              return pagination?.cursor === null
            })
            first?.query.prepend(value)
          },
          remove: (target: unknown, keyBy?: CoreOptimisticKeySelector) => {
            for (const { query } of queries) {
              query.remove(target, keyBy)
            }
          },
          replace: (
            target: unknown,
            value: unknown,
            keyBy?: CoreOptimisticKeySelector
          ) => {
            for (const { query } of queries) {
              query.replace(target, value, keyBy)
            }
          },
          update: (
            target: unknown,
            value: unknown,
            keyBy?: CoreOptimisticKeySelector
          ) => {
            for (const { query } of queries) {
              query.update(target, value, keyBy)
            }
          }
        }
      }
    }
    const layer: OptimisticLayer = {
      args,
      operations,
      path,
      requestId: null,
      startedAt: this.#now()
    }

    optimistic({
      args,
      optimisticId: `optimistic:${crypto.randomUUID()}`,
      store
    })
    this.#optimisticLayers.push(layer)
    this.#recomputeLayerEntries(layer)
    return layer
  }

  static #optimisticQuery(
    entry: QueryEntry,
    operations: OptimisticOperation[],
    collectionField?: 'page'
  ): CoreOptimisticQuery {
    return {
      append: (value) =>
        operations.push({
          ...(collectionField === undefined ? {} : { collectionField }),
          key: entry.descriptor.key,
          type: 'append',
          value
        }),
      insert: (value, position) =>
        operations.push({
          ...(collectionField === undefined ? {} : { collectionField }),
          key: entry.descriptor.key,
          position,
          type: 'insert',
          value
        }),
      merge: (value) =>
        operations.push({ key: entry.descriptor.key, type: 'merge', value }),
      modify: (value) =>
        operations.push({ key: entry.descriptor.key, type: 'modify', value }),
      prepend: (value) =>
        operations.push({
          ...(collectionField === undefined ? {} : { collectionField }),
          key: entry.descriptor.key,
          type: 'prepend',
          value
        }),
      remove: (target, keyBy) =>
        operations.push({
          ...(collectionField === undefined ? {} : { collectionField }),
          key: entry.descriptor.key,
          keyBy,
          target,
          type: 'remove'
        }),
      replace: (target, value, keyBy) =>
        operations.push({
          ...(collectionField === undefined ? {} : { collectionField }),
          key: entry.descriptor.key,
          keyBy,
          target,
          type: 'replace',
          value
        }),
      update: (target, value, keyBy) =>
        operations.push({
          ...(collectionField === undefined ? {} : { collectionField }),
          key: entry.descriptor.key,
          keyBy,
          target,
          type: 'update',
          value
        }),
      upsert: (value, keyBy) =>
        operations.push({
          ...(collectionField === undefined ? {} : { collectionField }),
          key: entry.descriptor.key,
          keyBy,
          type: 'upsert',
          value
        })
    }
  }

  #paginatedEntries(path: string, args: Readonly<Record<string, unknown>>) {
    const expected = JSON.stringify(canonicalConvexValue(args))
    return [...this.#queries.values()].filter((entry) => {
      if (entry.descriptor.path !== path) {
        return false
      }
      const decoded = decodeConvexValue(entry.descriptor.args)
      if (!QueryCore.#isRecord(decoded) || !('paginationOpts' in decoded)) {
        return false
      }
      const { paginationOpts: _, ...baseArgs } = decoded
      return JSON.stringify(canonicalConvexValue(baseArgs)) === expected
    })
  }

  static #paginationOptions(entry: QueryEntry) {
    const args = decodeConvexValue(entry.descriptor.args)
    if (!QueryCore.#isRecord(args)) {
      return null
    }
    const { paginationOpts } = args
    return QueryCore.#isRecord(paginationOpts) ? paginationOpts : null
  }

  async #settleMutation<Data>(
    promise: Promise<Data>,
    layer: OptimisticLayer | null
  ) {
    try {
      const data = await promise
      if (layer !== null) {
        this.#removeOptimisticLayer(layer, 'confirmed')
      }
      return data
    } catch (error) {
      if (layer !== null) {
        this.#removeOptimisticLayer(layer, 'rolled-back')
      }
      throw error
    }
  }

  async #retryMutation<Data>(
    path: string,
    args: Readonly<Record<string, unknown>>,
    layer: OptimisticLayer | null,
    retries: number,
    initialRequest: MutationRequest
  ): Promise<Data> {
    try {
      return (await initialRequest.promise) as Data
    } catch (error) {
      if (retries === 0) {
        throw error
      }
      return this.#retryMutation(
        path,
        args,
        layer,
        retries - 1,
        this.#startMutation(path, args, layer)
      )
    }
  }

  #startMutation(
    path: string,
    args: Readonly<Record<string, unknown>>,
    layer: OptimisticLayer | null
  ) {
    const request = this.#driver.mutationWithId({
      args: QueryCore.#encodedArgs(args),
      path
    })
    if (layer !== null && this.#optimisticLayers.includes(layer)) {
      const isNewLayer = layer.requestId === null
      if (layer.requestId !== null) {
        this.#optimisticLayersByRequestId.delete(layer.requestId)
      }
      layer.requestId = request.requestId
      this.#optimisticLayersByRequestId.set(request.requestId, layer)
      if (isNewLayer) {
        this.#recordOptimisticEvent(layer, 'created')
      }
    }
    return request
  }

  async #releaseDeduplicatedMutation(key: string, promise: Promise<unknown>) {
    try {
      await promise
    } catch {
      // The caller observes the original mutation rejection.
    } finally {
      if (this.#deduplicatedMutations.get(key)?.promise === promise) {
        this.#deduplicatedMutations.delete(key)
        this.#notifyDevtools()
      }
    }
  }

  #recomputeLayerEntries(layer: OptimisticLayer) {
    const startedTransition = !this.#isMutationTransitionActive
    if (startedTransition) {
      this.#isMutationTransitionActive = true
    }
    for (const key of new Set(
      layer.operations.map((operation) => operation.key)
    )) {
      const entry = this.#queries.get(key)
      if (entry !== undefined) {
        this.#recompute(entry)
      }
    }
    if (startedTransition) {
      this.#endMutationTransition()
    }
  }

  #recompute(entry: QueryEntry) {
    let snapshot = entry.serverSnapshot
    if (snapshot.status === 'success') {
      let { data } = snapshot
      for (const layer of this.#optimisticLayers) {
        for (const operation of layer.operations) {
          if (operation.key === entry.descriptor.key) {
            data = QueryCore.#applyOptimisticOperation(data, operation)
          }
        }
      }
      snapshot = { ...snapshot, data }
    }
    entry.snapshot = snapshot
    entry.result = QueryCore.#snapshotResult(snapshot)
    this.#notifyDevtools()
    if (this.#isMutationTransitionActive) {
      this.#pendingNotifications.add(entry)
      return
    }
    QueryCore.#notify(entry)
  }

  #beginMutationTransition(requestIds: readonly number[]) {
    this.#isMutationTransitionActive = true
    for (const requestId of requestIds) {
      const layer = this.#optimisticLayersByRequestId.get(requestId)
      if (layer !== undefined) {
        this.#removeOptimisticLayer(layer, 'confirmed')
      }
    }
  }

  #endMutationTransition() {
    this.#isMutationTransitionActive = false
    const notifications = [...this.#pendingNotifications]
    this.#pendingNotifications.clear()
    for (const entry of notifications) {
      QueryCore.#notify(entry)
    }
  }

  #removeOptimisticLayer(
    layer: OptimisticLayer,
    eventType?: CoreDevtoolsOptimisticEvent['type']
  ) {
    const index = this.#optimisticLayers.indexOf(layer)
    if (index === -1) {
      return
    }
    this.#optimisticLayers.splice(index, 1)
    if (layer.requestId !== null) {
      this.#optimisticLayersByRequestId.delete(layer.requestId)
    }
    if (eventType !== undefined) {
      this.#recordOptimisticEvent(layer, eventType)
    }
    this.#recomputeLayerEntries(layer)
  }

  #recordOptimisticEvent(
    layer: OptimisticLayer,
    type: CoreDevtoolsOptimisticEvent['type'],
    queryPath: string | null = null
  ) {
    this.#optimisticEventHistory.unshift({
      at: this.#now(),
      path: layer.path,
      queryPath,
      requestId: layer.requestId,
      type
    })
    if (this.#optimisticEventHistory.length > 100) {
      this.#optimisticEventHistory.length = 100
    }
    this.#notifyDevtools()
  }

  static #notify(entry: QueryEntry) {
    for (const listener of entry.listeners) {
      listener()
    }
  }

  static #applyOptimisticOperation(
    value: unknown,
    operation: OptimisticOperation
  ) {
    if (
      'collectionField' in operation &&
      operation.collectionField !== undefined &&
      QueryCore.#isRecord(value)
    ) {
      const collection = value[operation.collectionField]
      return Array.isArray(collection)
        ? {
            ...value,
            [operation.collectionField]:
              QueryCore.#applyOptimisticArrayOperation(collection, operation)
          }
        : value
    }
    if (Array.isArray(value)) {
      return QueryCore.#applyOptimisticArrayOperation(value, operation)
    }
    if (operation.type === 'merge' && QueryCore.#isRecord(value)) {
      return { ...value, ...operation.value }
    }
    if (operation.type === 'modify') {
      return operation.value
    }
    return value
  }

  static #applyOptimisticArrayOperation(
    value: readonly unknown[],
    operation: OptimisticOperation
  ) {
    if (operation.type === 'append') {
      return [...value, operation.value]
    }
    if (operation.type === 'prepend') {
      return [operation.value, ...value]
    }
    if (operation.type === 'insert') {
      const target =
        'before' in operation.position
          ? operation.position.before
          : operation.position.after
      const index = QueryCore.#findOptimisticIndex(
        value,
        target,
        operation.position.keyBy
      )
      if (index === -1) {
        return value
      }
      const insertionIndex = 'before' in operation.position ? index : index + 1
      return [
        ...value.slice(0, insertionIndex),
        operation.value,
        ...value.slice(insertionIndex)
      ]
    }
    if (operation.type === 'remove') {
      const index = QueryCore.#findOptimisticIndex(
        value,
        operation.target,
        operation.keyBy
      )
      return index === -1
        ? value
        : [...value.slice(0, index), ...value.slice(index + 1)]
    }
    return QueryCore.#applyOptimisticArrayWrite(value, operation)
  }

  static #applyOptimisticArrayWrite(
    value: readonly unknown[],
    operation: OptimisticOperation
  ) {
    if (operation.type === 'replace') {
      const index = QueryCore.#findOptimisticIndex(
        value,
        operation.target,
        operation.keyBy
      )
      return index === -1
        ? value
        : value.map((item, itemIndex) =>
            itemIndex === index ? operation.value : item
          )
    }
    if (operation.type === 'update') {
      const index = QueryCore.#findOptimisticIndex(
        value,
        operation.target,
        operation.keyBy
      )
      if (index === -1) {
        return value
      }
      return value.map((item, itemIndex) => {
        if (itemIndex !== index) {
          return item
        }
        return QueryCore.#isRecord(item) && QueryCore.#isRecord(operation.value)
          ? { ...item, ...operation.value }
          : operation.value
      })
    }
    if (operation.type === 'upsert') {
      const target = QueryCore.#optimisticKey(operation.value, operation.keyBy)
      const index = QueryCore.#findOptimisticIndex(
        value,
        target,
        operation.keyBy
      )
      return index === -1
        ? [...value, operation.value]
        : value.map((item, itemIndex) =>
            itemIndex === index ? operation.value : item
          )
    }
    return value
  }

  static #findOptimisticIndex(
    value: readonly unknown[],
    target: unknown,
    keyBy?: CoreOptimisticKeySelector
  ) {
    return value.findIndex((item) =>
      Object.is(QueryCore.#optimisticKey(item, keyBy), target)
    )
  }

  static #optimisticKey(value: unknown, keyBy?: CoreOptimisticKeySelector) {
    if (keyBy !== undefined) {
      return keyBy(value)
    }
    return QueryCore.#isRecord(value) && '_id' in value ? value._id : value
  }

  static #isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  static #snapshotResult(snapshot: CoreQuerySnapshot<unknown>) {
    if (snapshot.status === 'success') {
      return { status: 'success', value: snapshot.data } as const
    }
    if (snapshot.status === 'error') {
      return { error: snapshot.error, status: 'error' } as const
    }
    return null
  }

  static #encodedArgs(args: Readonly<Record<string, unknown>>) {
    return encodeConvexValue(args) as Readonly<Record<string, unknown>>
  }

  #notifyDevtools() {
    for (const listener of this.#devtoolsListeners) {
      try {
        listener()
      } catch {
        // Debug listeners cannot interrupt cache progress.
      }
    }
  }

  static #defaultClearTimer(timer: unknown) {
    clearTimeout(timer as ReturnType<typeof setTimeout>)
  }

  static #defaultSetTimer(callback: () => void, delay: number) {
    return globalThis.setTimeout(callback, delay)
  }
}

const pendingQuerySnapshot = {
  data: undefined,
  error: null,
  isLoading: true,
  status: 'pending'
} as const

export type CoreQueryHandle<Data> = Readonly<{
  getCacheGeneration: () => number
  getResult: () => SyncQueryResult | null
  getSnapshot: () => CoreQuerySnapshot<Data>
  subscribe: (listener: () => void) => () => void
  subscribeWithCurrent: (listener: () => void) => () => void
}>

export type CoreDevtoolsSnapshot = Readonly<{
  deduplicatedMutations: readonly CoreDevtoolsDeduplicatedMutation[]
  optimisticEvents: readonly CoreDevtoolsOptimisticEvent[]
  optimisticLayers: readonly CoreDevtoolsOptimisticLayer[]
  queries: readonly CoreDevtoolsQuery[]
}>

export type CoreDevtoolsOptimisticEvent = Readonly<{
  at: number
  path: string
  queryPath: string | null
  requestId: number | null
  type: 'auth-removed' | 'confirmed' | 'created' | 'replayed' | 'rolled-back'
}>

export type CoreDevtoolsDeduplicatedMutation = Readonly<{
  callerCount: number
  key: string
  path: string
  requestId: number
}>

export type CoreDevtoolsOptimisticLayer = Readonly<{
  args: Readonly<Record<string, unknown>>
  index: number
  operations: readonly CoreDevtoolsOptimisticOperation[]
  path: string
  requestId: number | null
  startedAt: number
}>

export type CoreDevtoolsOptimisticOperation = Readonly<{
  args: Readonly<Record<string, unknown>>
  hasCustomKeySelector: boolean
  path: string
  position: CoreOptimisticInsertPosition | null
  target: unknown
  type: OptimisticOperation['type']
  value: unknown
}>

export type CoreDevtoolsQuery = Readonly<{
  args: Readonly<Record<string, unknown>>
  data: unknown
  error: Error | null
  expiresAt: number | null
  gcTime: number
  key: string
  optimisticLayerCount: number
  path: string
  serverData: unknown
  status: CoreQuerySnapshot<unknown>['status']
  subscriberCount: number
  updatedAt: number | null
}>

export type CoreQuerySnapshot<Data> =
  | CoreQueryPendingSnapshot
  | CoreQueryErrorSnapshot
  | CoreQuerySuccessSnapshot<Data>

export type CoreQueryPendingSnapshot = Readonly<{
  data: undefined
  error: null
  isLoading: true
  status: 'pending'
}>

export type CoreQueryErrorSnapshot = Readonly<{
  data: undefined
  error: Error
  isLoading: false
  status: 'error'
}>

export type CoreQuerySuccessSnapshot<Data> = Readonly<{
  data: Data
  error: null
  isLoading: false
  status: 'success'
}>

export type CoreOptimisticContext = Readonly<{
  args: Readonly<Record<string, unknown>>
  optimisticId: string
  store: CoreOptimisticStore
}>

export type CoreOptimisticStore = Readonly<{
  get: (
    path: string,
    args: Readonly<Record<string, unknown>>
  ) => CoreOptimisticQuery
  paginated: (
    path: string,
    args: Readonly<Record<string, unknown>>
  ) => CoreOptimisticPaginatedQuery
}>

export type CoreOptimisticPaginatedQuery = Readonly<{
  appendIfLoaded: (value: unknown) => void
  prepend: (value: unknown) => void
  remove: (key: unknown, keyBy?: CoreOptimisticKeySelector) => void
  replace: (
    key: unknown,
    value: unknown,
    keyBy?: CoreOptimisticKeySelector
  ) => void
  update: (
    key: unknown,
    value: unknown,
    keyBy?: CoreOptimisticKeySelector
  ) => void
}>

export type CoreOptimisticQuery = Readonly<{
  append: (value: unknown) => void
  insert: (value: unknown, position: CoreOptimisticInsertPosition) => void
  merge: (value: Readonly<Record<string, unknown>>) => void
  modify: (value: unknown) => void
  prepend: (value: unknown) => void
  remove: (key: unknown, keyBy?: CoreOptimisticKeySelector) => void
  replace: (
    key: unknown,
    value: unknown,
    keyBy?: CoreOptimisticKeySelector
  ) => void
  update: (
    key: unknown,
    value: unknown,
    keyBy?: CoreOptimisticKeySelector
  ) => void
  upsert: (value: unknown, keyBy?: CoreOptimisticKeySelector) => void
}>

type QueryDriver = Readonly<{
  mutationWithId: (mutation: {
    args: Readonly<Record<string, unknown>>
    path: string
  }) => MutationRequest
  subscribe: (
    query: QueryDescriptor,
    listener: (result: SyncQueryResult) => void
  ) => () => void
  subscribeMutationTransitions: (
    listener: MutationTransitionListener
  ) => () => void
}>

type QueryCoreOptions = Readonly<{
  clearTimer?: (timer: unknown) => void
  gcTime?: number
  now?: () => number
  setTimer?: (callback: () => void, delay: number) => unknown
}>

type MutationRequest = Readonly<{
  promise: Promise<unknown>
  requestId: number
}>

type MutationTransitionListener = Readonly<{
  begin: (requestIds: readonly number[]) => void
  end: () => void
}>

type QueryDescriptor = Readonly<{
  args: Readonly<Record<string, unknown>>
  key: string
  path: string
}>

type QueryEntry = {
  descriptor: QueryDescriptor
  expiresAt: number | null
  gcTimer: unknown | null
  handle: CoreQueryHandle<unknown> | null
  listeners: Set<() => void>
  release: (() => void) | null
  retries: number
  result: SyncQueryResult | null
  serverSnapshot: CoreQuerySnapshot<unknown>
  snapshot: CoreQuerySnapshot<unknown>
  updatedAt: number | null
}

type OptimisticLayer = {
  args: Readonly<Record<string, unknown>>
  operations: OptimisticOperation[]
  path: string
  requestId: number | null
  startedAt: number
}

type DeduplicatedMutation = {
  callerCount: number
  path: string
  promise: Promise<unknown>
  requestId: number
}

type OptimisticOperation =
  | {
      collectionField?: 'page'
      key: string
      type: 'append'
      value: unknown
    }
  | {
      collectionField?: 'page'
      key: string
      position: CoreOptimisticInsertPosition
      type: 'insert'
      value: unknown
    }
  | { key: string; type: 'merge'; value: Readonly<Record<string, unknown>> }
  | { key: string; type: 'modify'; value: unknown }
  | {
      collectionField?: 'page'
      key: string
      type: 'prepend'
      value: unknown
    }
  | {
      collectionField?: 'page'
      key: string
      keyBy: CoreOptimisticKeySelector | undefined
      target: unknown
      type: 'remove'
    }
  | {
      collectionField?: 'page'
      key: string
      keyBy: CoreOptimisticKeySelector | undefined
      target: unknown
      type: 'replace'
      value: unknown
    }
  | {
      collectionField?: 'page'
      key: string
      keyBy: CoreOptimisticKeySelector | undefined
      target: unknown
      type: 'update'
      value: unknown
    }
  | {
      collectionField?: 'page'
      key: string
      keyBy: CoreOptimisticKeySelector | undefined
      type: 'upsert'
      value: unknown
    }

type CoreOptimisticInsertPosition = Readonly<
  | { after: unknown; before?: never; keyBy?: CoreOptimisticKeySelector }
  | { after?: never; before: unknown; keyBy?: CoreOptimisticKeySelector }
>

type CoreOptimisticKeySelector = (value: unknown) => unknown
