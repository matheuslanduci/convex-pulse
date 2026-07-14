import { mountConvexPulseDevtools } from 'convex-pulse/devtools'
import {
  ConvexPulseVueClient,
  provideConvexPulse,
  useAction,
  useMutation,
  useOnDataChange,
  usePrefetchQuery,
  useQuery
} from 'convex-pulse/vue'
import type { FunctionReference } from 'convex/server'
import { createApp, defineComponent, h, onErrorCaptured, ref } from 'vue'

import { api } from '#convex/api'

const scenario = new URLSearchParams(location.search).get('scenario')
const client = new ConvexPulseVueClient(
  import.meta.env.VITE_CONVEX_URL,
  scenario === 'auth-options' ? { fetchToken: fetchClerkToken } : {}
)
const runId = crypto.randomUUID()
if (scenario === 'devtools') {
  mountConvexPulseDevtools(client, { initialIsOpen: true })
}
const getValue = api.fixture.getValue as FunctionReference<
  'query',
  'public',
  { key: string; runId: string },
  string
>
const setValue = api.fixture.setValue as FunctionReference<
  'mutation',
  'public',
  { key: string; runId: string; value: string },
  string
>

const connection = defineComponent({
  setup() {
    const query = useQuery(getValue, {
      args: { key: 'vue-connection', runId }
    })

    return () => {
      if (query.value.status === 'pending' || query.value.status === 'error') {
        return h('p', query.value.status)
      }

      return h('p', { 'data-value': query.value.data }, 'Connected to Convex')
    }
  }
})

const authentication = defineComponent({
  setup() {
    const query = useQuery(api.fixture.getIdentity, { args: {} })

    return () =>
      h(
        'p',
        `Identity: ${query.value.status === 'success' ? (query.value.data?.name ?? 'anonymous') : query.value.status}`
      )
  }
})

const pagination = defineComponent({
  setup() {
    const query = useQuery(api.fixture.paginateLabels, {
      args: { prefix: 'vue' },
      pagination: { initialNumItems: 2 }
    })
    return () =>
      h('section', [
        h('p', `Pagination: ${query.value.data?.join(', ')}`),
        h(
          'button',
          {
            disabled: !query.value.canLoadMore,
            onClick: () => query.value.loadMore(3),
            type: 'button'
          },
          'Load more'
        )
      ])
  }
})

const optimistic = defineComponent({
  setup() {
    const key = 'vue-optimistic'
    const hookChange = ref('none')
    const optionChange = ref('none')
    const query = useQuery(getValue, {
      args: { key, runId },
      onDataChange: ({ next, previous }) => {
        optionChange.value = `${previous} -> ${next}`
      },
      select: String
    })
    useOnDataChange(query, ({ next, previous }) => {
      hookChange.value = `${previous} -> ${next}`
    })
    const updateValue = useMutation(setValue, {
      optimistic: ({ data, store }) =>
        store
          .get(getValue, { key: data.key, runId: data.runId })
          .modify(data.value)
    })
    const mutationResult = ref('not called')

    async function update() {
      mutationResult.value = await updateValue({
        key,
        runId,
        value: 'changed in Vue'
      })
    }

    return () =>
      h('section', [
        h(
          'p',
          `Query: ${query.value.status === 'success' ? String(query.value.data) : query.value.status}`
        ),
        h('p', `Mutation: ${mutationResult.value}`),
        h('p', `Option changes: ${optionChange.value}`),
        h('p', `Hook changes: ${hookChange.value}`),
        h('button', { onClick: () => void update(), type: 'button' }, [
          'Update value'
        ])
      ])
  }
})

const enabledQuery = defineComponent({
  setup() {
    const enabled = ref(false)
    const query = useQuery(getValue, {
      args: { key: 'vue-enabled', runId },
      enabled
    })

    return () =>
      h('section', [
        h('p', `Enabled query: ${query.value.status}`),
        h(
          'button',
          {
            onClick: () => {
              enabled.value = !enabled.value
            },
            type: 'button'
          },
          [enabled.value ? 'Disable query' : 'Enable query']
        )
      ])
  }
})

const reactiveQuery = defineComponent({
  setup() {
    const key = ref<string>()
    const query = useQuery(getValue, {
      args: () => (key.value === undefined ? 'skip' : { key: key.value, runId })
    })

    return () =>
      h('section', [
        h('p', `Reactive query: ${String(key.value)}, ${query.value.status}`),
        h(
          'button',
          { onClick: () => (key.value = 'vue-first'), type: 'button' },
          'Load first arguments'
        ),
        h(
          'button',
          { onClick: () => (key.value = 'vue-second'), type: 'button' },
          'Switch arguments'
        ),
        h(
          'button',
          { onClick: () => (key.value = undefined), type: 'button' },
          'Skip query'
        )
      ])
  }
})

const throwingQuery = defineComponent({
  setup() {
    const query = useQuery(api.fixture.throwQueryError, {
      args: {},
      throwOnError: true
    })
    return () => h('p', query.value.status)
  }
})

const queryErrorBoundary = defineComponent({
  setup() {
    const error = ref<Error>()
    onErrorCaptured((caught) => {
      error.value = caught
      return false
    })
    return () =>
      error.value === undefined
        ? h(throwingQuery)
        : h('p', `Boundary: ${error.value.message}`)
  }
})

const queryError = defineComponent({
  setup() {
    const query = useQuery(api.fixture.throwQueryError, { args: {} })

    return () =>
      h(
        'p',
        query.value.status === 'error'
          ? query.value.error.message
          : query.value.status
      )
  }
})

const mutationError = defineComponent({
  setup() {
    const fail = useMutation(api.fixture.throwMutationError)
    const result = ref('not called')

    async function runFailure() {
      try {
        await fail()
      } catch (error) {
        result.value = errorMessage(error)
      }
    }

    return () =>
      h('section', [
        h('p', `Mutation error: ${result.value}`),
        h(
          'p',
          `Observable error: ${fail.status}, ${fail.error?.message ?? ''}`
        ),
        h('button', { onClick: () => void runFailure(), type: 'button' }, [
          'Fail mutation'
        ])
      ])
  }
})

const mutationState = defineComponent({
  setup() {
    const events = ref<string[]>([])
    const mutation = useMutation(setValue, {
      onMutate: () => events.value.push('mutate'),
      onSettled: ({ error }) =>
        events.value.push(error === null ? 'settled:success' : 'settled:error'),
      onSuccess: ({ data }) => events.value.push(`success:${data}`)
    })

    function start() {
      client.setAuth(
        () =>
          new Promise<string | null>((resolve) => {
            globalThis.setTimeout(() => resolve(null), 60_000)
          })
      )
      void mutation({
        key: 'mutation-state',
        runId,
        value: 'observable Vue mutation'
      })
    }

    return () =>
      h('section', [
        h(
          'p',
          `Mutation state: ${mutation.status}, ${String(mutation.isPending)}, ${String(mutation.data)}`
        ),
        h('p', `Mutation events: ${events.value.join(', ')}`),
        h('button', { onClick: start, type: 'button' }, 'Start mutation'),
        h(
          'button',
          { onClick: () => client.clearAuth(), type: 'button' },
          'Complete mutation'
        ),
        h(
          'button',
          { onClick: mutation.reset, type: 'button' },
          'Reset mutation'
        )
      ])
  }
})

const actionState = defineComponent({
  setup() {
    const event = ref('none')
    const action = useAction(api.fixture.echoAction, {
      onSuccess: ({ data }) => {
        event.value = `success:${String(data)}`
      }
    })

    return () =>
      h('section', [
        h(
          'p',
          `Action state: ${action.status}, ${String(action.isPending)}, ${String(action.data)}`
        ),
        h('p', `Action event: ${event.value}`),
        h(
          'button',
          {
            onClick: () => void action({ value: 'observable Vue action' }),
            type: 'button'
          },
          'Run action hook'
        ),
        h(
          'button',
          { onClick: action.reset, type: 'button' },
          'Reset action hook'
        )
      ])
  }
})

const prefetch = defineComponent({
  setup() {
    const prefetchValue = usePrefetchQuery(getValue)
    const result = ref('not called')

    async function runPrefetch() {
      const handle = prefetchValue({ key: 'vue-prefetch', runId })

      result.value = String(await handle.ready)
    }

    return () =>
      h('section', [
        h('p', `Prefetch: ${result.value}`),
        h('button', { onClick: () => void runPrefetch(), type: 'button' }, [
          'Prefetch value'
        ])
      ])
  }
})

const publicApi = defineComponent({
  setup() {
    const runtimeExports = ref('loading')

    async function loadPublicApi() {
      const entryPoint = await import('convex-pulse/vue')

      runtimeExports.value = Object.keys(entryPoint).toSorted().join(', ')
    }

    void loadPublicApi()

    return () => h('p', runtimeExports.value)
  }
})

const app = defineComponent({
  setup() {
    provideConvexPulse(client)

    if (scenario === 'optimistic') {
      return () => h(optimistic)
    }
    if (scenario === 'query-error') {
      return () => h(queryError)
    }
    if (scenario === 'mutation-error') {
      return () => h(mutationError)
    }
    if (scenario === 'mutation-state') {
      return () => h(mutationState)
    }
    if (scenario === 'action-state') {
      return () => h(actionState)
    }
    if (scenario === 'prefetch') {
      return () => h(prefetch)
    }
    if (scenario === 'public-api') {
      return () => h(publicApi)
    }
    if (scenario === 'enabled-query') {
      return () => h(enabledQuery)
    }
    if (scenario === 'reactive-query') {
      return () => h(reactiveQuery)
    }
    if (scenario === 'throw-query') {
      return () => h(queryErrorBoundary)
    }
    if (scenario === 'pagination') {
      return () => h(pagination)
    }
    if (scenario === 'auth-options') {
      return () => h(authentication)
    }

    return () => h(connection)
  }
})

createApp(app).mount('#root')

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function fetchClerkToken(_options: { forceRefreshToken: boolean }) {
  return Promise.resolve(import.meta.env.VITE_CLERK_E2E_TOKEN)
}
