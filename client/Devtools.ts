import type {
  CoreDevtoolsDeduplicatedMutation,
  CoreDevtoolsOptimisticEvent,
  CoreDevtoolsOptimisticLayer,
  CoreDevtoolsQuery,
  QueryCore
} from '#client/QueryCore.js'
import type {
  SyncClient,
  SyncDevtoolsAction,
  SyncDevtoolsMutation
} from '#client/SyncClient.js'

export class DevtoolsBridge {
  readonly #core: QueryCore
  readonly #sync: SyncClient

  constructor(core: QueryCore, sync: SyncClient) {
    this.#core = core
    this.#sync = sync
  }

  getSnapshot(): DevtoolsSnapshot {
    const core = this.#core.getDevtoolsSnapshot()
    const sync = this.#sync.getDevtoolsSnapshot()

    return {
      actions: sync.actions,
      connection: sync.connection,
      deduplicatedMutations: core.deduplicatedMutations,
      lastCloseReason: sync.lastCloseReason,
      mutations: sync.mutations,
      optimisticEvents: core.optimisticEvents,
      optimisticLayers: core.optimisticLayers,
      queries: core.queries
    }
  }

  subscribe(listener: () => void) {
    const releaseCore = this.#core.subscribeDevtools(listener)
    const releaseSync = this.#sync.subscribeDevtools(listener)
    let active = true

    return () => {
      if (!active) {
        return
      }
      active = false
      releaseCore()
      releaseSync()
    }
  }
}

export type DevtoolsHandle = Readonly<{
  getSnapshot: () => DevtoolsSnapshot
  subscribe: (listener: () => void) => () => void
}>

export type DevtoolsSnapshot = Readonly<{
  actions: readonly DevtoolsAction[]
  connection: 'connected' | 'connecting' | 'disconnected'
  deduplicatedMutations: readonly DevtoolsDeduplicatedMutation[]
  lastCloseReason: string | null
  mutations: readonly DevtoolsMutation[]
  optimisticEvents: readonly DevtoolsOptimisticEvent[]
  optimisticLayers: readonly DevtoolsOptimisticLayer[]
  queries: readonly DevtoolsQuery[]
}>

export type DevtoolsAction = SyncDevtoolsAction

export type DevtoolsDeduplicatedMutation = CoreDevtoolsDeduplicatedMutation

export type DevtoolsMutation = SyncDevtoolsMutation

export type DevtoolsOptimisticEvent = CoreDevtoolsOptimisticEvent

export type DevtoolsOptimisticLayer = CoreDevtoolsOptimisticLayer

export type DevtoolsQuery = CoreDevtoolsQuery
