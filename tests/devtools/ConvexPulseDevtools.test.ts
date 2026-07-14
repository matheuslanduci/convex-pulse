import {
  ConvexPulseDevtools,
  mountConvexPulseDevtools
} from 'convex-pulse/devtools'
import type { DevtoolsSnapshot } from 'convex-pulse/devtools'
import { expect, it, vi } from 'vitest'

it('mounts an isolated panel, renders updates, and cleans up subscriptions', () => {
  const listeners = new Set<() => void>()
  let snapshot: DevtoolsSnapshot = {
    actions: [],
    connection: 'connected',
    deduplicatedMutations: [],
    lastCloseReason: null,
    mutations: [],
    optimisticEvents: [],
    optimisticLayers: [],
    queries: [
      {
        args: { id: 'one' },
        data: 'ready',
        error: null,
        expiresAt: null,
        gcTime: 300_000,
        key: 'tasks:get:one',
        optimisticLayerCount: 0,
        path: 'tasks:get',
        serverData: 'ready',
        status: 'success',
        subscriberCount: 1,
        updatedAt: 1000
      }
    ]
  }
  const handle = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }

  const devtools = mountConvexPulseDevtools(
    { devtools: handle },
    { initialIsOpen: true }
  )
  const host = document.querySelector<HTMLElement>(
    '[data-convex-pulse-devtools]'
  )
  const root = host?.shadowRoot

  expect(devtools).toBeInstanceOf(ConvexPulseDevtools)
  expect(root?.textContent).toContain('Convex Pulse DevTools')
  expect(root?.querySelector('.pulse-mark svg')).toBeTruthy()
  expect(root?.textContent).toContain('tasks:get')
  expect(root?.textContent).toContain('1 subscribed')
  expect(listeners.size).toBe(1)

  snapshot = {
    ...snapshot,
    mutations: [
      {
        args: { value: 'after' },
        completedAt: null,
        error: null,
        path: 'values:set',
        phase: 'queued',
        requestId: 4,
        result: undefined,
        startedAt: Date.now()
      }
    ],
    queries: []
  }
  for (const listener of listeners) {
    listener()
  }
  const mutationsTab = [...(root?.querySelectorAll('button') ?? [])].find(
    (button) => button.textContent?.includes('Mutations')
  )
  mutationsTab?.click()

  expect(root?.textContent).toContain('values:set')
  expect(root?.textContent).toContain('queued')

  snapshot = {
    ...snapshot,
    mutations: [
      {
        args: { value: 'after' },
        completedAt: Date.now() + 20,
        error: null,
        path: 'values:set',
        phase: 'success',
        requestId: 4,
        result: 'after',
        startedAt: Date.now()
      }
    ]
  }
  for (const listener of listeners) {
    listener()
  }

  expect(root?.textContent).toContain('success')
  expect(root?.textContent).toContain('Result')
  expect(root?.textContent).toContain('after')

  devtools.unmount()
  expect(document.querySelector('[data-convex-pulse-devtools]')).toBeNull()
  expect(listeners.size).toBe(0)
})

it('places the panel and trigger at the configured viewport corner', () => {
  const snapshot: DevtoolsSnapshot = {
    actions: [],
    connection: 'connected',
    deduplicatedMutations: [],
    lastCloseReason: null,
    mutations: [],
    optimisticEvents: [],
    optimisticLayers: [],
    queries: []
  }
  const devtools = mountConvexPulseDevtools(
    { getSnapshot: () => snapshot, subscribe: () => vi.fn() },
    { initialIsOpen: true, position: 'top-left' }
  )
  const host = document.querySelector<HTMLElement>(
    '[data-convex-pulse-devtools]'
  )

  expect(host?.dataset.position).toBe('top-left')
  expect(host?.shadowRoot?.querySelector('.position-top-left')).toBeTruthy()
  devtools.unmount()
})

it('renders action history, optimistic layers, and deduplicated callers', () => {
  const now = Date.now()
  const snapshot: DevtoolsSnapshot = {
    actions: [
      {
        args: { value: 'action result' },
        completedAt: now + 10,
        error: null,
        path: 'values:act',
        phase: 'success',
        requestId: 5,
        result: 'action result',
        startedAt: now
      }
    ],
    connection: 'connected',
    deduplicatedMutations: [
      {
        callerCount: 2,
        key: 'values:set:one',
        path: 'values:set',
        requestId: 6
      }
    ],
    lastCloseReason: null,
    mutations: [],
    optimisticEvents: [
      {
        at: now,
        path: 'values:set',
        queryPath: 'values:list',
        requestId: 6,
        type: 'replayed'
      }
    ],
    optimisticLayers: [
      {
        args: { value: 'optimistic' },
        index: 0,
        operations: [
          {
            args: {},
            hasCustomKeySelector: false,
            path: 'values:list',
            position: null,
            target: undefined,
            type: 'append',
            value: 'optimistic'
          }
        ],
        path: 'values:set',
        requestId: 6,
        startedAt: now
      }
    ],
    queries: []
  }
  const devtools = mountConvexPulseDevtools(
    { getSnapshot: () => snapshot, subscribe: () => vi.fn() },
    { initialIsOpen: true }
  )
  const root = document.querySelector<HTMLElement>(
    '[data-convex-pulse-devtools]'
  )?.shadowRoot
  const actionsTab = [...(root?.querySelectorAll('button') ?? [])].find(
    (button) => button.textContent?.includes('Actions')
  )
  actionsTab?.click()

  expect(root?.textContent).toContain('values:act')
  expect(root?.textContent).toContain('action result')

  const optimisticTab = [...(root?.querySelectorAll('button') ?? [])].find(
    (button) => button.textContent?.includes('Optimistic')
  )
  optimisticTab?.click()

  expect(root?.textContent).toContain('Layer 1')
  expect(root?.textContent).toContain('Ordered operations')
  expect(root?.textContent).toContain('2 callers')
  expect(root?.textContent).toContain('replayed')
  devtools.unmount()
})

it('rejects mounting the same devtools instance twice', () => {
  const handle = {
    getSnapshot: (): DevtoolsSnapshot => ({
      actions: [],
      connection: 'connecting',
      deduplicatedMutations: [],
      lastCloseReason: null,
      mutations: [],
      optimisticEvents: [],
      optimisticLayers: [],
      queries: []
    }),
    subscribe: vi.fn(() => vi.fn())
  }
  const devtools = new ConvexPulseDevtools(handle).mount()

  expect(() => devtools.mount()).toThrow('already mounted')
  devtools.unmount()
})
