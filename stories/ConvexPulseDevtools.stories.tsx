import type { Meta, StoryObj } from '@storybook/react-vite'
import { ConvexPulseDevtools } from 'convex-pulse/devtools'
import type {
  ConvexPulseDevtoolsPosition,
  DevtoolsHandle,
  DevtoolsSnapshot
} from 'convex-pulse/devtools'
import { useEffect, useRef } from 'react'

const meta = {
  argTypes: {
    position: {
      control: 'select',
      options: ['bottom-right', 'bottom-left', 'top-right', 'top-left']
    }
  },
  args: {
    position: 'bottom-right'
  },
  component: DevtoolsPreview,
  parameters: {
    docs: {
      description: {
        component:
          'The real framework-agnostic Convex Pulse inspector, mounted with a representative client snapshot.'
      }
    }
  },
  title: 'Devtools/Convex Pulse Devtools'
} satisfies Meta<typeof DevtoolsPreview>

export default meta

function DevtoolsPreview(props: DevtoolsPreviewProps) {
  const container = useRef<HTMLDivElement>(null)
  const currentSnapshot = props.snapshot ?? snapshot

  useEffect(() => {
    if (container.current === null) {
      return
    }

    const handle: DevtoolsHandle = {
      getSnapshot: () => currentSnapshot,
      subscribe: () => releaseSubscription
    }
    const devtools = new ConvexPulseDevtools(handle, {
      initialIsOpen: true,
      position: props.position
    }).mount(container.current)

    return () => devtools.unmount()
  }, [currentSnapshot, props.position])

  return (
    <div
      ref={container}
      style={{
        background:
          'radial-gradient(circle at 20% 10%, #ffffff 0, #eef0f5 38%, #e3e6ed 100%)',
        minHeight: '100vh'
      }}
    />
  )
}

function releaseSubscription() {
  return null
}

const now = Date.now()
const snapshot: DevtoolsSnapshot = {
  actions: [
    {
      args: { prompt: 'Summarize the current sprint' },
      completedAt: now - 820,
      error: null,
      path: 'assistant:generateSummary',
      phase: 'success',
      requestId: 43,
      result: { wordCount: 184 },
      startedAt: now - 2140
    }
  ],
  connection: 'connected',
  deduplicatedMutations: [
    {
      callerCount: 3,
      key: 'tasks:toggle:task_01',
      path: 'tasks:toggle',
      requestId: 42
    }
  ],
  lastCloseReason: null,
  mutations: [
    {
      args: { done: true, id: 'task_01' },
      completedAt: null,
      error: null,
      path: 'tasks:setDone',
      phase: 'awaiting-transition',
      requestId: 42,
      result: undefined,
      startedAt: now - 680
    },
    {
      args: { title: 'Polish the devtools' },
      completedAt: now - 3100,
      error: null,
      path: 'tasks:create',
      phase: 'success',
      requestId: 41,
      result: 'task_02',
      startedAt: now - 3280
    }
  ],
  optimisticEvents: [
    {
      at: now - 640,
      path: 'tasks:setDone',
      queryPath: 'tasks:list',
      requestId: 42,
      type: 'replayed'
    }
  ],
  optimisticLayers: [
    {
      args: { done: true, id: 'task_01' },
      index: 0,
      operations: [
        {
          args: {},
          hasCustomKeySelector: false,
          path: 'tasks:list',
          position: null,
          target: 'task_01',
          type: 'merge',
          value: { done: true }
        }
      ],
      path: 'tasks:setDone',
      requestId: 42,
      startedAt: now - 680
    }
  ],
  queries: [
    {
      args: {},
      data: [
        { done: true, id: 'task_01', title: 'Design a better inspector' },
        { done: false, id: 'task_02', title: 'Polish the devtools' }
      ],
      error: null,
      expiresAt: null,
      gcTime: 300_000,
      key: 'tasks:list:{}',
      optimisticLayerCount: 1,
      path: 'tasks:list',
      serverData: [
        { done: false, id: 'task_01', title: 'Design a better inspector' },
        { done: false, id: 'task_02', title: 'Polish the devtools' }
      ],
      status: 'success',
      subscriberCount: 2,
      updatedAt: now - 1100
    },
    {
      args: { id: 'profile_01' },
      data: { name: 'Ada Lovelace', role: 'Engineer' },
      error: null,
      expiresAt: now + 42_000,
      gcTime: 300_000,
      key: 'profiles:get:{id:profile_01}',
      optimisticLayerCount: 0,
      path: 'profiles:get',
      serverData: { name: 'Ada Lovelace', role: 'Engineer' },
      status: 'success',
      subscriberCount: 0,
      updatedAt: now - 18_000
    }
  ]
}

export const Populated: Story = {}

export const Empty: Story = {
  args: {
    snapshot: {
      ...snapshot,
      actions: [],
      deduplicatedMutations: [],
      mutations: [],
      optimisticEvents: [],
      optimisticLayers: [],
      queries: []
    }
  }
}

type Story = StoryObj<typeof meta>

type DevtoolsPreviewProps = {
  position: ConvexPulseDevtoolsPosition
  snapshot?: DevtoolsSnapshot
}
