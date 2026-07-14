import {
  functionError,
  SyncActionError,
  SyncAuthError,
  SyncClientClosedError,
  SyncMutationError,
  SyncProtocolError,
  SyncQueryError
} from '#client/errors.js'
import { stateVersionsEqual, zeroStateVersion } from '#client/protocol.js'
import type {
  ActionFrame,
  ActionResponse,
  AddQuery,
  AuthError,
  ClientFrame,
  MutationFrame,
  MutationResponse,
  ServerMessage,
  StateModification,
  Transition
} from '#client/protocol.js'
import { decodeConvexValue } from '#client/valueCodec.js'

export class SyncClient {
  readonly #transport: SyncTransport
  readonly #actions = new Map<number, PendingAction>()
  readonly #actionHistory: SyncDevtoolsAction[] = []
  readonly #devtoolsListeners = new Set<() => void>()
  readonly #queriesByKey = new Map<string, QueryEntry>()
  readonly #queryRoutes = new Map<number, QueryRoute>()
  readonly #mutations = new Map<number, PendingMutation>()
  readonly #mutationHistory: SyncDevtoolsMutation[] = []
  readonly #mutationReflectionHeap: MutationReflectionEntry[] = []
  readonly #mutationTransitionListeners =
    new Set<SyncMutationTransitionListener>()
  readonly #releaseMessageListener: () => void
  readonly #releaseConnectionListener: () => void
  readonly #sessionId: string
  readonly #now: () => number
  readonly #clearTimer: (timer: unknown) => void
  readonly #setTimer: (callback: () => void, delay: number) => unknown
  readonly #beforeUnloadTarget: BeforeUnloadTarget | null
  readonly #refreshTokenLeewaySeconds: number
  readonly #pendingQueryModifications = new Map<
    number,
    AddQuery | Readonly<{ queryId: number; type: 'Remove' }>
  >()
  #authConfig: SyncAuthConfig | null = null
  #authConfirmedToken: string | null = null
  #authDesiredToken: string | null = null
  #authFetchPending = false
  #authFailureCount = 0
  #authGateClosed = false
  #authGeneration = 0
  #authMustReauthenticate = false
  #authPendingConfirmation = false
  #authRefreshTimer: unknown | null = null
  #authShouldNotifyOnConfirmation = false
  #authWasRefreshing = false
  #beforeUnloadListening = false
  #connected = false
  #closed = false
  #connectionCount = 0
  #connectionTrafficInitialized = false
  #identityVersion = 0
  #lastCloseReason: string | null = null
  #maxObservedTimestamp = 0n
  #nextListenerId = 0
  #nextQueryId = 0
  #nextRequestId = 0
  #querySetVersion = 0
  #replayRequestsAfterAuth = false
  #remoteVersion = zeroStateVersion()

  constructor(transport: SyncTransport, options: SyncClientOptions = {}) {
    this.#transport = transport
    this.#sessionId = (options.randomUuid ?? (() => crypto.randomUUID()))()
    this.#now = options.now ?? Date.now
    this.#clearTimer = options.clearTimer ?? SyncClient.#clearAuthTimer
    this.#setTimer = options.setTimer ?? SyncClient.#defaultSetTimer
    this.#beforeUnloadTarget =
      options.beforeUnloadTarget ?? SyncClient.#browserBeforeUnloadTarget()
    this.#refreshTokenLeewaySeconds = options.refreshTokenLeewaySeconds ?? 60

    if (this.#sessionId.length === 0) {
      throw new TypeError('The session ID must not be empty')
    }

    this.#releaseMessageListener = transport.subscribe((message) => {
      this.#receive(message)
    })
    this.#releaseConnectionListener = transport.subscribeConnection((event) => {
      this.#connectionChanged(event)
    })
  }

  setAuth(fetchToken: SyncAuthTokenFetcher, options: SyncAuthOptions = {}) {
    this.#assertOpen()
    this.#authGeneration += 1
    const generation = this.#authGeneration
    this.#clearAuthRefreshTimer()
    this.#authConfig = {
      fetchToken,
      onChange: options.onChange ?? SyncClient.#ignoreAuthChange,
      onError: options.onError ?? SyncClient.#ignoreAuthError,
      onRefreshChange:
        options.onRefreshChange ?? SyncClient.#ignoreAuthRefreshChange
    }
    this.#authFailureCount = 0
    this.#authMustReauthenticate = false
    this.#authShouldNotifyOnConfirmation = true
    this.#beginAuthUpdate(false)
    void this.#fetchAuthToken(generation, false)
  }

  clearAuth() {
    this.#assertOpen()
    this.#authGeneration += 1
    this.#clearAuthRefreshTimer()
    this.#authFetchPending = false
    this.#authDesiredToken = null
    this.#authMustReauthenticate = false
    this.#authShouldNotifyOnConfirmation = false
    this.#beginAuthUpdate(false)

    if (this.#connected && this.#authConfirmedToken !== null) {
      this.#sendAuthenticate(null)
      return
    }

    this.#completeAnonymousAuth()
  }

  subscribe(query: SyncQuery, listener: SyncQueryListener): () => void {
    this.#assertOpen()
    let entry = this.#queriesByKey.get(query.key)

    if (entry === undefined) {
      const queryId = this.#nextQueryId
      this.#nextQueryId += 1
      entry = {
        generation: (this.#latestGeneration(query.key) ?? 0) + 1,
        journal: null,
        listeners: new Map(),
        query,
        queryId,
        result: null
      }
      this.#queriesByKey.set(query.key, entry)
      this.#queryRoutes.set(queryId, { entry, state: 'current' })
      this.#sendQueryModification(SyncClient.#addQuery(entry))
    }

    const listenerId = this.#nextListenerId
    this.#nextListenerId += 1
    entry.listeners.set(listenerId, listener)

    if (entry.result !== null) {
      const { result } = entry
      queueMicrotask(() => {
        if (
          !this.#closed &&
          !this.#authGateClosed &&
          entry?.listeners.has(listenerId)
        ) {
          SyncClient.#runListener(listener, result)
        }
      })
    }

    let active = true
    return () => {
      if (!active) {
        return
      }
      active = false
      this.#unsubscribe(entry as QueryEntry, listenerId)
    }
  }

  mutation(mutation: SyncMutation): Promise<unknown> {
    return this.mutationWithId(mutation).promise
  }

  mutationWithId(mutation: SyncMutation): SyncMutationRequest {
    const requestId = this.#nextRequestId
    this.#nextRequestId += 1
    if (this.#closed) {
      return {
        promise: Promise.reject(new SyncClientClosedError()),
        requestId
      }
    }
    const frame: MutationFrame = {
      args: [mutation.args],
      requestId,
      type: 'Mutation',
      udfPath: mutation.path
    }
    const promise = new Promise<unknown>((resolve, reject) => {
      this.#mutations.set(requestId, {
        frame,
        phase: 'queued',
        reject,
        resolve,
        startedAt: this.#now()
      })
    })
    this.#updateBeforeUnloadWarning()

    if (this.#connected && !this.#authGateClosed) {
      this.#transport.send(frame)
      const pending = this.#mutations.get(requestId) as PendingMutation
      pending.phase = 'sent'
    }

    this.#notifyDevtools()

    return { promise, requestId }
  }

  getDevtoolsSnapshot(): SyncDevtoolsSnapshot {
    let connection: SyncDevtoolsSnapshot['connection'] = 'disconnected'
    if (!this.#closed && this.#connected) {
      connection = 'connected'
    } else if (
      !this.#closed &&
      this.#connectionCount === 0 &&
      this.#lastCloseReason === null
    ) {
      connection = 'connecting'
    }

    return {
      actions: [
        ...[...this.#actions.entries()].map(
          ([requestId, pending]): SyncDevtoolsAction => ({
            args: decodeConvexValue(pending.frame.args[0]) as Readonly<
              Record<string, unknown>
            >,
            completedAt: null,
            error: null,
            path: pending.frame.udfPath,
            phase: pending.phase,
            requestId,
            result: undefined,
            startedAt: pending.startedAt
          })
        ),
        ...this.#actionHistory
      ].toSorted((left, right) => right.requestId - left.requestId),
      connection,
      lastCloseReason: this.#lastCloseReason,
      mutations: [
        ...[...this.#mutations.entries()].map(
          ([requestId, pending]): SyncDevtoolsMutation => ({
            args: decodeConvexValue(pending.frame.args[0]) as Readonly<
              Record<string, unknown>
            >,
            completedAt: null,
            error: null,
            path: pending.frame.udfPath,
            phase: pending.phase,
            requestId,
            result: undefined,
            startedAt: pending.startedAt
          })
        ),
        ...this.#mutationHistory
      ].toSorted((left, right) => right.requestId - left.requestId)
    }
  }

  subscribeDevtools(listener: () => void) {
    this.#devtoolsListeners.add(listener)
    return () => this.#devtoolsListeners.delete(listener)
  }

  subscribeMutationTransitions(listener: SyncMutationTransitionListener) {
    this.#assertOpen()
    this.#mutationTransitionListeners.add(listener)
    return () => this.#mutationTransitionListeners.delete(listener)
  }

  action(action: SyncAction): Promise<unknown> {
    if (this.#closed) {
      return Promise.reject(new SyncClientClosedError())
    }

    const requestId = this.#nextRequestId
    this.#nextRequestId += 1
    const frame: ActionFrame = {
      args: [action.args],
      requestId,
      type: 'Action',
      udfPath: action.path
    }
    const promise = new Promise<unknown>((resolve, reject) => {
      this.#actions.set(requestId, {
        frame,
        phase: 'queued',
        reject,
        resolve,
        startedAt: this.#now()
      })
    })
    this.#updateBeforeUnloadWarning()

    if (this.#connected && !this.#authGateClosed) {
      this.#transport.send(frame)
      const pending = this.#actions.get(requestId) as PendingAction

      pending.phase = 'sent'
    }

    this.#notifyDevtools()

    return promise
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return
    }

    this.#closed = true
    this.#connected = false
    this.#authGeneration += 1
    this.#clearAuthRefreshTimer()
    this.#releaseMessageListener()
    this.#releaseConnectionListener()

    const error = new SyncClientClosedError()
    for (const action of this.#actions.values()) {
      action.reject(error)
    }
    this.#actions.clear()
    for (const mutation of this.#mutations.values()) {
      mutation.reject(error)
    }

    this.#mutations.clear()
    this.#updateBeforeUnloadWarning()
    this.#mutationReflectionHeap.length = 0
    this.#mutationTransitionListeners.clear()
    this.#queriesByKey.clear()
    this.#queryRoutes.clear()
    this.#pendingQueryModifications.clear()
    this.#notifyDevtools()
    this.#devtoolsListeners.clear()
    await this.#transport.close()
  }

  #beginAuthUpdate(isRefreshing: boolean) {
    this.#authGateClosed = true
    if (isRefreshing && !this.#authWasRefreshing) {
      this.#authWasRefreshing = true
      this.#notifyAuthRefreshChange(true)
    }
  }

  async #fetchAuthToken(generation: number, forceRefreshToken: boolean) {
    const config = this.#authConfig
    if (config === null) {
      return
    }
    this.#authFetchPending = true

    let token: string | null | undefined
    try {
      token = await config.fetchToken({ forceRefreshToken })
    } catch (error) {
      if (generation !== this.#authGeneration || this.#closed) {
        return
      }
      this.#authFetchPending = false
      this.#authUnavailable(
        new SyncAuthError('Could not fetch an auth token', {
          cause: error
        })
      )
      return
    }

    if (generation !== this.#authGeneration || this.#closed) {
      return
    }

    if (!token && !forceRefreshToken) {
      await this.#fetchAuthToken(generation, true)
      return
    }

    this.#authFetchPending = false
    if (!token) {
      this.#authUnavailable(
        new SyncAuthError('Auth token fetch returned no token')
      )
      return
    }

    this.#authDesiredToken = token
    if (
      token === this.#authConfirmedToken &&
      !this.#authPendingConfirmation &&
      !this.#authMustReauthenticate
    ) {
      const wasRefreshing = this.#authWasRefreshing
      this.#authGateClosed = false
      if (this.#authShouldNotifyOnConfirmation) {
        this.#authShouldNotifyOnConfirmation = false
        this.#notifyAuthChange(true)
      }
      this.#finishAuthRefresh()
      if (!wasRefreshing) {
        this.#scheduleAuthRefresh(token)
      }
      this.#flushPendingQueryModifications()
      this.#sendPendingRequests()
      return
    }

    if (!this.#connected) {
      return
    }

    this.#sendAuthenticate(token)
    if (!this.#connectionTrafficInitialized) {
      this.#sendFullQuerySet()
    }
  }

  #authUnavailable(error: SyncAuthError) {
    this.#notifyAuthError(error)
    this.#authDesiredToken = null
    this.#authMustReauthenticate = false
    this.#authShouldNotifyOnConfirmation = false
    if (this.#connected && this.#authConfirmedToken !== null) {
      this.#sendAuthenticate(null)
      return
    }
    if (this.#connected) {
      this.#completeAnonymousAuth()
      return
    }
    this.#notifyAuthChange(false)
    this.#finishAuthRefresh()
  }

  #sendAuthenticate(token: string | null) {
    const baseVersion = this.#identityVersion
    this.#identityVersion += 1
    this.#authPendingConfirmation = true
    this.#authMustReauthenticate = false
    this.#transport.send(
      token === null
        ? { baseVersion, tokenType: 'None', type: 'Authenticate' }
        : {
            baseVersion,
            tokenType: 'User',
            type: 'Authenticate',
            value: token
          }
    )
  }

  #completeAuthConfirmation() {
    this.#authPendingConfirmation = false
    this.#authConfirmedToken = this.#authDesiredToken
    this.#authGateClosed = false
    this.#authFailureCount = 0
    this.#authMustReauthenticate = false

    if (this.#authConfirmedToken === null) {
      this.#completeAnonymousAuth()
      return
    }

    if (this.#authShouldNotifyOnConfirmation) {
      this.#authShouldNotifyOnConfirmation = false
      this.#notifyAuthChange(true)
    }
    this.#finishAuthRefresh()
    this.#scheduleAuthRefresh(this.#authConfirmedToken)
    this.#flushPendingQueryModifications()
    this.#sendPendingRequests()
  }

  #completeAnonymousAuth() {
    this.#authPendingConfirmation = false
    this.#authConfirmedToken = null
    this.#authGateClosed = false
    this.#notifyAuthChange(false)
    this.#finishAuthRefresh()
    this.#flushPendingQueryModifications()
    this.#sendPendingRequests()
  }

  #receiveAuthError(message: AuthError) {
    if (
      message.baseVersion + 1 < this.#identityVersion ||
      (!message.authUpdateAttempted && this.#authPendingConfirmation)
    ) {
      return
    }

    const config = this.#authConfig
    if (config === null || this.#authFailureCount >= 2) {
      this.#authDesiredToken = null
      this.#authConfirmedToken = null
      this.#authPendingConfirmation = false
      this.#authGateClosed = true
      this.#notifyAuthError(new SyncAuthError(message.error))
      this.#notifyAuthChange(false)
      this.#finishAuthRefresh()
      return
    }

    this.#authFailureCount += 1
    this.#authMustReauthenticate = true
    this.#connected = false
    this.#authPendingConfirmation = false
    this.#authGeneration += 1
    const generation = this.#authGeneration
    this.#beginAuthUpdate(true)
    void this.#fetchAuthToken(generation, true)
  }

  #sendFullQuerySet() {
    for (const [queryId, route] of this.#queryRoutes) {
      if (route.state === 'draining') {
        this.#queryRoutes.delete(queryId)
      }
    }
    const activeQueries = [...this.#queriesByKey.values()]
      .toSorted((left, right) => left.queryId - right.queryId)
      .map((entry) => SyncClient.#addQuery(entry))

    if (activeQueries.length > 0) {
      this.#querySetVersion = 1
      this.#transport.send({
        baseVersion: 0,
        modifications: activeQueries,
        newVersion: 1,
        type: 'ModifyQuerySet'
      })
    }
    this.#connectionTrafficInitialized = true
  }

  #flushPendingQueryModifications() {
    if (!this.#connected || this.#pendingQueryModifications.size === 0) {
      return
    }
    const modifications = [
      ...this.#pendingQueryModifications.values()
    ].toSorted((left, right) => left.queryId - right.queryId)
    this.#pendingQueryModifications.clear()
    const baseVersion = this.#querySetVersion
    this.#querySetVersion += 1
    this.#transport.send({
      baseVersion,
      modifications,
      newVersion: this.#querySetVersion,
      type: 'ModifyQuerySet'
    })
  }

  #rejectInFlightActions() {
    for (const [requestId, pending] of this.#actions) {
      if (pending.phase !== 'sent') {
        continue
      }
      this.#actions.delete(requestId)
      const error = new SyncActionError(
        'Connection lost while action was in flight',
        undefined
      )
      this.#recordAction(requestId, pending, 'error', undefined, error)
      pending.reject(error)
    }
    this.#updateBeforeUnloadWarning()
  }

  #sendPendingRequests() {
    if (!this.#connected || this.#authGateClosed) {
      return
    }
    const pendingRequestList: PendingRequest[] = [
      ...[...this.#mutations.values()].map((pending) => ({
        kind: 'mutation' as const,
        pending
      })),
      ...[...this.#actions.values()].map((pending) => ({
        kind: 'action' as const,
        pending
      }))
    ].toSorted(
      (left, right) =>
        left.pending.frame.requestId - right.pending.frame.requestId
    )

    let changed = false
    for (const request of pendingRequestList) {
      if (
        request.pending.phase !== 'queued' &&
        !(this.#replayRequestsAfterAuth && request.kind === 'mutation')
      ) {
        continue
      }
      this.#transport.send(request.pending.frame)
      if (request.pending.phase === 'queued') {
        request.pending.phase = 'sent'
        changed = true
      }
    }
    this.#replayRequestsAfterAuth = false
    if (changed) {
      this.#notifyDevtools()
    }
  }

  #scheduleAuthRefresh(token: string) {
    this.#clearAuthRefreshTimer()
    const expiration = SyncClient.#jwtExpiration(token)
    if (expiration === null || this.#authConfig === null) {
      return
    }
    const delay = Math.min(
      20 * 24 * 60 * 60 * 1000,
      Math.max(
        0,
        expiration * 1000 - this.#now() - this.#refreshTokenLeewaySeconds * 1000
      )
    )
    this.#authRefreshTimer = this.#setTimer(() => {
      this.#authRefreshTimer = null
      if (this.#closed || this.#authConfig === null) {
        return
      }
      this.#authGeneration += 1
      const generation = this.#authGeneration
      this.#authShouldNotifyOnConfirmation = false
      this.#beginAuthUpdate(true)
      void this.#fetchAuthToken(generation, true)
    }, delay)
  }

  #clearAuthRefreshTimer() {
    if (this.#authRefreshTimer === null) {
      return
    }
    this.#clearTimer(this.#authRefreshTimer)
    this.#authRefreshTimer = null
  }

  #finishAuthRefresh() {
    if (!this.#authWasRefreshing) {
      return
    }
    this.#authWasRefreshing = false
    this.#notifyAuthRefreshChange(false)
  }

  #notifyAuthChange(isAuthenticated: boolean) {
    try {
      this.#authConfig?.onChange(isAuthenticated)
    } catch {
      // A user callback cannot interrupt protocol progress.
    }
  }

  #notifyAuthRefreshChange(isRefreshing: boolean) {
    try {
      this.#authConfig?.onRefreshChange(isRefreshing)
    } catch {
      // A user callback cannot interrupt protocol progress.
    }
  }

  #notifyAuthError(error: SyncAuthError) {
    try {
      this.#authConfig?.onError(error)
    } catch {
      // A user callback cannot interrupt protocol progress.
    }
  }

  #connectionChanged(event: SyncConnectionEvent) {
    if (this.#closed) {
      return
    }

    if (event.type === 'disconnected') {
      this.#connected = false
      this.#lastCloseReason = event.reason ?? null
      this.#notifyDevtools()
      return
    }

    this.#connected = true
    this.#remoteVersion = zeroStateVersion()
    this.#authPendingConfirmation = false
    this.#authConfirmedToken = null
    this.#identityVersion = 0
    this.#querySetVersion = 0
    this.#connectionTrafficInitialized = false
    this.#replayRequestsAfterAuth = true
    this.#pendingQueryModifications.clear()
    this.#transport.send({
      clientTs: this.#now(),
      connectionCount: this.#connectionCount,
      lastCloseReason: this.#lastCloseReason,
      ...(this.#maxObservedTimestamp === 0n
        ? {}
        : { maxObservedTimestamp: this.#maxObservedTimestamp }),
      sessionId: this.#sessionId,
      type: 'Connect'
    })

    this.#rejectInFlightActions()

    if (this.#authFetchPending) {
      this.#connectionCount += 1
      this.#notifyDevtools()
      return
    }

    if (this.#authDesiredToken !== null) {
      this.#authGateClosed = true
      this.#sendAuthenticate(this.#authDesiredToken)
      this.#sendFullQuerySet()
      this.#connectionCount += 1
      this.#notifyDevtools()
      return
    }

    this.#authGateClosed = false
    this.#sendFullQuerySet()
    this.#sendPendingRequests()

    this.#connectionCount += 1
    this.#notifyDevtools()
  }

  #receive(message: ServerMessage) {
    if (this.#closed) {
      return
    }

    if (message.type === 'Transition') {
      this.#applyTransition(message)
      return
    }

    if (message.type === 'MutationResponse') {
      this.#receiveMutationResponse(message)
      return
    }

    if (message.type === 'ActionResponse') {
      this.#receiveActionResponse(message)
      return
    }

    if (message.type === 'AuthError') {
      this.#receiveAuthError(message)
      return
    }

    if (message.type === 'FatalError') {
      void this.#fail(message.error)
    }
  }

  #applyTransition(transition: Transition) {
    if (!stateVersionsEqual(transition.startVersion, this.#remoteVersion)) {
      throw new SyncProtocolError('Transition start version does not match')
    }

    const confirmsAuth =
      this.#authPendingConfirmation &&
      transition.endVersion.identity > transition.startVersion.identity &&
      transition.endVersion.identity >= this.#identityVersion
    const staged = new Map<QueryEntry, StagedQueryUpdate>()
    const removedRoutes: number[] = []

    for (const modification of transition.modifications) {
      const route = this.#queryRoutes.get(modification.queryId)
      if (route === undefined) {
        throw new SyncProtocolError(`Unknown query ID: ${modification.queryId}`)
      }

      if (modification.type === 'QueryRemoved') {
        removedRoutes.push(modification.queryId)
        const update = staged.get(route.entry)
        if (update !== undefined) {
          update.journal = undefined
        }
        continue
      }

      const result = SyncClient.#queryResult(modification)
      staged.set(route.entry, { journal: modification.journal, result })
    }

    this.#remoteVersion = { ...transition.endVersion }
    if (transition.endVersion.ts > this.#maxObservedTimestamp) {
      this.#maxObservedTimestamp = transition.endVersion.ts
    }

    for (const queryId of removedRoutes) {
      this.#queryRoutes.delete(queryId)
    }

    const notifications: Readonly<{
      entry: QueryEntry
      result: SyncQueryResult
    }>[] = []
    for (const [entry, update] of staged) {
      const { result } = update
      entry.result = result
      if (update.journal !== undefined) {
        entry.journal = update.journal
      }
      const route = this.#queryRoutes.get(entry.queryId)
      if (
        SyncClient.#shouldNotifyQuery(
          route,
          this.#queriesByKey.get(entry.query.key),
          entry,
          !this.#authGateClosed || confirmsAuth
        )
      ) {
        notifications.push({ entry, result })
      }
    }

    if (this.#mutationTransitionListeners.size === 0) {
      if (confirmsAuth) {
        this.#completeAuthConfirmation()
      }
      for (const notification of notifications) {
        for (const listener of notification.entry.listeners.values()) {
          SyncClient.#runListener(listener, notification.result)
        }
      }
      this.#reflectMutations(transition.endVersion.ts)
      return
    }

    const reflected = this.#takeReflectedMutations(transition.endVersion.ts)
    this.#publishMutationTransition(reflected, () => {
      if (confirmsAuth) {
        this.#completeAuthConfirmation()
      }

      for (const notification of notifications) {
        for (const listener of notification.entry.listeners.values()) {
          SyncClient.#runListener(listener, notification.result)
        }
      }
    })
  }

  #receiveMutationResponse(response: MutationResponse) {
    const pending = this.#mutations.get(response.requestId)
    if (pending === undefined || pending.phase === 'awaiting-transition') {
      return
    }

    if (!response.success) {
      this.#mutations.delete(response.requestId)
      this.#updateBeforeUnloadWarning()
      const error = functionError(
        new SyncMutationError(response.result, response.errorData),
        response.errorData
      )
      this.#recordMutation(
        response.requestId,
        pending,
        'error',
        undefined,
        error
      )
      this.#notifyDevtools()
      pending.reject(error)
      return
    }

    pending.phase = 'awaiting-transition'
    pending.commitTs = response.ts
    pending.value = response.result
    mutationReflectionHeapPush(this.#mutationReflectionHeap, {
      requestId: response.requestId,
      timestamp: response.ts
    })
    this.#notifyDevtools()
    if (this.#mutationTransitionListeners.size === 0) {
      this.#reflectMutations(this.#remoteVersion.ts)
    } else {
      this.#publishMutationTransition(
        this.#takeReflectedMutations(this.#remoteVersion.ts),
        SyncClient.#doNothing
      )
    }
  }

  #receiveActionResponse(response: ActionResponse) {
    const pending = this.#actions.get(response.requestId)
    if (pending === undefined) {
      return
    }

    this.#actions.delete(response.requestId)
    this.#updateBeforeUnloadWarning()
    if (response.success) {
      this.#recordAction(
        response.requestId,
        pending,
        'success',
        response.result,
        null
      )
      this.#notifyDevtools()
      pending.resolve(response.result)
      return
    }
    const error = functionError(
      new SyncActionError(response.result, response.errorData),
      response.errorData
    )
    this.#recordAction(response.requestId, pending, 'error', undefined, error)
    this.#notifyDevtools()
    pending.reject(error)
  }

  #reflectMutations(timestamp: bigint) {
    const reflected: number[] = []
    while (
      this.#mutationReflectionHeap[0] !== undefined &&
      this.#mutationReflectionHeap[0].timestamp <= timestamp
    ) {
      const entry = mutationReflectionHeapPop(this.#mutationReflectionHeap)
      if (entry !== undefined) {
        reflected.push(entry.requestId)
      }
    }
    reflected.sort((left, right) => left - right)

    let changed = false
    for (const requestId of reflected) {
      const pending = this.#mutations.get(requestId)
      if (
        pending === undefined ||
        pending.phase !== 'awaiting-transition' ||
        pending.commitTs === undefined ||
        pending.commitTs > timestamp
      ) {
        continue
      }
      this.#mutations.delete(requestId)
      this.#recordMutation(requestId, pending, 'success', pending.value, null)
      changed = true
      pending.resolve(pending.value)
    }
    if (changed) {
      this.#updateBeforeUnloadWarning()
      this.#notifyDevtools()
    }
  }

  #takeReflectedMutations(timestamp: bigint) {
    const reflected: number[] = []
    while (
      this.#mutationReflectionHeap[0] !== undefined &&
      this.#mutationReflectionHeap[0].timestamp <= timestamp
    ) {
      const entry = mutationReflectionHeapPop(this.#mutationReflectionHeap)
      if (entry !== undefined) {
        reflected.push(entry.requestId)
      }
    }
    reflected.sort((left, right) => left - right)

    const pendingList: ReflectedMutation[] = []
    for (const requestId of reflected) {
      const pending = this.#mutations.get(requestId)
      if (
        pending === undefined ||
        pending.phase !== 'awaiting-transition' ||
        pending.commitTs === undefined ||
        pending.commitTs > timestamp
      ) {
        continue
      }
      this.#mutations.delete(requestId)
      this.#recordMutation(requestId, pending, 'success', pending.value, null)
      pendingList.push({ pending, requestId })
    }
    if (pendingList.length > 0) {
      this.#updateBeforeUnloadWarning()
      this.#notifyDevtools()
    }
    return pendingList
  }

  #publishMutationTransition(
    reflected: readonly ReflectedMutation[],
    publishQueries: () => void
  ) {
    if (reflected.length === 0) {
      publishQueries()
      return
    }

    const requestIds = reflected.map(({ requestId }) => requestId)
    for (const listener of this.#mutationTransitionListeners) {
      SyncClient.#runTransitionHook(() => listener.begin(requestIds))
    }
    try {
      publishQueries()
    } finally {
      for (const listener of this.#mutationTransitionListeners) {
        SyncClient.#runTransitionHook(listener.end)
      }
    }
    for (const { pending } of reflected) {
      pending.resolve(pending.value)
    }
  }

  #unsubscribe(entry: QueryEntry, listenerId: number) {
    entry.listeners.delete(listenerId)
    if (
      entry.listeners.size > 0 ||
      this.#queriesByKey.get(entry.query.key) !== entry
    ) {
      return
    }

    this.#queriesByKey.delete(entry.query.key)
    const route = this.#queryRoutes.get(entry.queryId)
    if (route !== undefined) {
      route.state = 'draining'
    }
    this.#sendQueryModification({ queryId: entry.queryId, type: 'Remove' })
  }

  #recordMutation(
    requestId: number,
    pending: PendingMutation,
    phase: 'error' | 'success',
    result: unknown,
    error: Error | null
  ) {
    this.#mutationHistory.unshift({
      args: decodeConvexValue(pending.frame.args[0]) as Readonly<
        Record<string, unknown>
      >,
      completedAt: this.#now(),
      error,
      path: pending.frame.udfPath,
      phase,
      requestId,
      result,
      startedAt: pending.startedAt
    })
    if (this.#mutationHistory.length > 100) {
      this.#mutationHistory.length = 100
    }
  }

  #recordAction(
    requestId: number,
    pending: PendingAction,
    phase: 'error' | 'success',
    result: unknown,
    error: Error | null
  ) {
    this.#actionHistory.unshift({
      args: decodeConvexValue(pending.frame.args[0]) as Readonly<
        Record<string, unknown>
      >,
      completedAt: this.#now(),
      error,
      path: pending.frame.udfPath,
      phase,
      requestId,
      result,
      startedAt: pending.startedAt
    })
    if (this.#actionHistory.length > 100) {
      this.#actionHistory.length = 100
    }
  }

  #sendQueryModification(
    modification: AddQuery | Readonly<{ queryId: number; type: 'Remove' }>
  ) {
    if (!this.#connected) {
      return
    }

    if (this.#authGateClosed) {
      const pending = this.#pendingQueryModifications.get(modification.queryId)
      if (pending?.type === 'Add' && modification.type === 'Remove') {
        this.#pendingQueryModifications.delete(modification.queryId)
        this.#queryRoutes.delete(modification.queryId)
      } else {
        this.#pendingQueryModifications.set(modification.queryId, modification)
      }
      return
    }

    const baseVersion = this.#querySetVersion
    this.#querySetVersion += 1
    this.#transport.send({
      baseVersion,
      modifications: [modification],
      newVersion: this.#querySetVersion,
      type: 'ModifyQuerySet'
    })
  }

  static #queryResult(
    modification: Exclude<StateModification, { type: 'QueryRemoved' }>
  ): SyncQueryResult {
    if (modification.type === 'QueryUpdated') {
      return { status: 'success', value: modification.value }
    }

    return {
      error: functionError(
        new SyncQueryError(modification.errorMessage, modification.errorData),
        modification.errorData
      ),
      status: 'error'
    }
  }

  static #addQuery(entry: QueryEntry): AddQuery {
    return {
      args: [entry.query.args],
      journal: entry.journal,
      queryId: entry.queryId,
      type: 'Add',
      udfPath: entry.query.path
    }
  }

  static #runListener(listener: SyncQueryListener, result: SyncQueryResult) {
    try {
      listener(result)
    } catch {
      // A user listener cannot interrupt protocol progress.
    }
  }

  static #runTransitionHook(hook: () => void) {
    try {
      hook()
    } catch {
      // Internal transition observers cannot interrupt protocol progress.
    }
  }

  static #doNothing() {
    void 0
  }

  static #shouldNotifyQuery(
    route: QueryRoute | undefined,
    currentEntry: QueryEntry | undefined,
    entry: QueryEntry,
    authCanPublish: boolean
  ) {
    return (
      authCanPublish && route?.state === 'current' && currentEntry === entry
    )
  }

  static #jwtExpiration(token: string) {
    const [, payload] = token.split('.')
    if (payload === undefined) {
      return null
    }
    try {
      const normalized = payload.replaceAll('-', '+').replaceAll('_', '/')
      const padded = normalized.padEnd(
        normalized.length + ((4 - (normalized.length % 4)) % 4),
        '='
      )
      const claims = JSON.parse(atob(padded)) as unknown
      if (
        claims === null ||
        typeof claims !== 'object' ||
        !('exp' in claims) ||
        typeof claims.exp !== 'number' ||
        !Number.isFinite(claims.exp)
      ) {
        return null
      }
      return claims.exp
    } catch {
      return null
    }
  }

  static #ignoreAuthChange(isAuthenticated: boolean) {
    void isAuthenticated
  }

  static #ignoreAuthRefreshChange(isRefreshing: boolean) {
    void isRefreshing
  }

  static #ignoreAuthError(error: SyncAuthError) {
    void error
  }

  static #clearAuthTimer(timer: unknown) {
    clearTimeout(timer as ReturnType<typeof setTimeout>)
  }

  static #defaultSetTimer(callback: () => void, delay: number) {
    return globalThis.setTimeout(callback, delay)
  }

  static #browserBeforeUnloadTarget(): BeforeUnloadTarget | null {
    return typeof window === 'undefined'
      ? null
      : (window as unknown as BeforeUnloadTarget)
  }

  #updateBeforeUnloadWarning() {
    const shouldListen = this.#mutations.size > 0 || this.#actions.size > 0
    if (shouldListen === this.#beforeUnloadListening) {
      return
    }
    this.#beforeUnloadListening = shouldListen
    if (shouldListen) {
      this.#beforeUnloadTarget?.addEventListener(
        'beforeunload',
        this.#preventBeforeUnload
      )
      return
    }
    this.#beforeUnloadTarget?.removeEventListener(
      'beforeunload',
      this.#preventBeforeUnload
    )
  }

  #preventBeforeUnload = (event: BeforeUnloadEventLike) => {
    if (!this.#beforeUnloadListening) {
      return
    }
    event.preventDefault()
    event.returnValue = true
  }

  #latestGeneration(key: string) {
    let generation: number | undefined
    for (const route of this.#queryRoutes.values()) {
      if (route.entry.query.key === key) {
        generation = Math.max(generation ?? 0, route.entry.generation)
      }
    }
    return generation
  }

  async #fail(message: string) {
    const error = new SyncProtocolError(message)
    for (const action of this.#actions.values()) {
      action.reject(error)
    }
    this.#actions.clear()
    for (const mutation of this.#mutations.values()) {
      mutation.reject(error)
    }
    this.#mutations.clear()
    this.#mutationReflectionHeap.length = 0
    await this.close()
  }

  #assertOpen() {
    if (this.#closed) {
      throw new SyncClientClosedError()
    }
  }

  #notifyDevtools() {
    for (const listener of this.#devtoolsListeners) {
      try {
        listener()
      } catch {
        // Debug listeners cannot interrupt protocol progress.
      }
    }
  }
}

function mutationReflectionHeapPush(
  heap: MutationReflectionEntry[],
  entry: MutationReflectionEntry
) {
  heap.push(entry)
  let index = heap.length - 1
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2)
    if (
      (heap[parent] as MutationReflectionEntry).timestamp <= entry.timestamp
    ) {
      break
    }
    heap[index] = heap[parent] as MutationReflectionEntry
    index = parent
  }
  heap[index] = entry
}

function mutationReflectionHeapPop(heap: MutationReflectionEntry[]) {
  const [first] = heap
  const last = heap.pop()
  if (first === undefined || last === undefined || heap.length === 0) {
    return first
  }
  let index = 0
  while (index * 2 + 1 < heap.length) {
    const left = index * 2 + 1
    const right = left + 1
    const child =
      right < heap.length &&
      (heap[right] as MutationReflectionEntry).timestamp <
        (heap[left] as MutationReflectionEntry).timestamp
        ? right
        : left
    if ((heap[child] as MutationReflectionEntry).timestamp >= last.timestamp) {
      break
    }
    heap[index] = heap[child] as MutationReflectionEntry
    index = child
  }
  heap[index] = last
  return first
}

export {
  SyncActionError,
  SyncAuthError,
  SyncClientClosedError,
  SyncMutationError,
  SyncProtocolError,
  SyncQueryError
} from '#client/errors.js'

export type SyncClientOptions = Readonly<{
  beforeUnloadTarget?: BeforeUnloadTarget | null
  clearTimer?: (timer: unknown) => void
  now?: () => number
  randomUuid?: () => string
  refreshTokenLeewaySeconds?: number
  setTimer?: (callback: () => void, delay: number) => unknown
}>

export type SyncAuthTokenFetcher = (options: {
  forceRefreshToken: boolean
}) => Promise<string | null | undefined>

export type SyncAuthOptions = Readonly<{
  onChange?: (isAuthenticated: boolean) => void
  onError?: (error: SyncAuthError) => void
  onRefreshChange?: (isRefreshing: boolean) => void
}>

export type SyncTransport = Readonly<{
  close: () => void | Promise<void>
  send: (frame: ClientFrame) => void
  subscribe: (listener: (message: ServerMessage) => void) => () => void
  subscribeConnection: (
    listener: (event: SyncConnectionEvent) => void
  ) => () => void
}>

export type SyncConnectionEvent = Readonly<{
  reason?: string
  type: 'connected' | 'disconnected' | 'reconnected'
}>

export type SyncQuery = Readonly<{
  args: Readonly<Record<string, unknown>>
  key: string
  path: string
}>

export type SyncMutation = Readonly<{
  args: Readonly<Record<string, unknown>>
  path: string
}>

type SyncMutationRequest = Readonly<{
  promise: Promise<unknown>
  requestId: number
}>

export type SyncAction = Readonly<{
  args: Readonly<Record<string, unknown>>
  path: string
}>

export type SyncQueryListener = (result: SyncQueryResult) => void

export type SyncQueryResult =
  | Readonly<{ status: 'success'; value: unknown }>
  | Readonly<{ error: Error; status: 'error' }>

export type SyncDevtoolsSnapshot = Readonly<{
  actions: readonly SyncDevtoolsAction[]
  connection: 'connected' | 'connecting' | 'disconnected'
  lastCloseReason: string | null
  mutations: readonly SyncDevtoolsMutation[]
}>

export type SyncDevtoolsAction = Readonly<{
  args: Readonly<Record<string, unknown>>
  completedAt: number | null
  error: Error | null
  path: string
  phase: 'error' | 'queued' | 'sent' | 'success'
  requestId: number
  result: unknown
  startedAt: number
}>

export type SyncDevtoolsMutation = Readonly<{
  args: Readonly<Record<string, unknown>>
  completedAt: number | null
  error: Error | null
  path: string
  phase: 'awaiting-transition' | 'error' | 'queued' | 'sent' | 'success'
  requestId: number
  result: unknown
  startedAt: number
}>

type QueryEntry = {
  generation: number
  journal: string | null
  listeners: Map<number, SyncQueryListener>
  query: SyncQuery
  queryId: number
  result: SyncQueryResult | null
}

type QueryRoute = {
  entry: QueryEntry
  state: 'current' | 'draining'
}

type StagedQueryUpdate = {
  journal: string | null | undefined
  result: SyncQueryResult
}

type MutationReflectionEntry = Readonly<{
  requestId: number
  timestamp: bigint
}>

type ReflectedMutation = Readonly<{
  pending: PendingMutation
  requestId: number
}>

type SyncMutationTransitionListener = Readonly<{
  begin: (requestIds: readonly number[]) => void
  end: () => void
}>

type PendingMutation = {
  commitTs?: bigint
  frame: MutationFrame
  phase: 'queued' | 'sent' | 'awaiting-transition'
  reject: (error: unknown) => void
  resolve: (value: unknown) => void
  startedAt: number
  value?: unknown
}

type PendingAction = {
  frame: ActionFrame
  phase: 'queued' | 'sent'
  reject: (error: unknown) => void
  resolve: (value: unknown) => void
  startedAt: number
}

type PendingRequest =
  | Readonly<{ kind: 'action'; pending: PendingAction }>
  | Readonly<{ kind: 'mutation'; pending: PendingMutation }>

type SyncAuthConfig = Readonly<{
  fetchToken: SyncAuthTokenFetcher
  onChange: (isAuthenticated: boolean) => void
  onError: (error: SyncAuthError) => void
  onRefreshChange: (isRefreshing: boolean) => void
}>

type BeforeUnloadTarget = Readonly<{
  addEventListener: (
    type: 'beforeunload',
    listener: (event: BeforeUnloadEventLike) => void
  ) => void
  removeEventListener: (
    type: 'beforeunload',
    listener: (event: BeforeUnloadEventLike) => void
  ) => void
}>

type BeforeUnloadEventLike = {
  preventDefault: () => void
  returnValue: unknown
}
