import { mountConvexPulseDevtools } from 'convex-pulse/devtools'
import {
  ConvexPulseSolidClient,
  createAction,
  createMutation,
  createOnDataChange,
  createPrefetchQuery,
  createQuery
} from 'convex-pulse/solid'
import type { FunctionReference } from 'convex/server'
import { catchError, createEffect, createRoot, createSignal } from 'solid-js'

import { api } from '#convex/api'

const scenario = new URLSearchParams(location.search).get('scenario')
const client = new ConvexPulseSolidClient(
  import.meta.env.VITE_CONVEX_URL,
  scenario === 'auth-options' ? { fetchToken: fetchClerkToken } : {}
)
const runId = crypto.randomUUID()
if (scenario === 'devtools') {
  mountConvexPulseDevtools(client, { initialIsOpen: true })
}
const root = document.querySelector('#root')
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

if (!(root instanceof HTMLElement)) {
  throw new Error('Missing Solid root')
}

createRoot(() => {
  if (scenario === 'optimistic') {
    renderOptimistic(root)
    return
  }
  if (scenario === 'query-error') {
    renderQueryError(root)
    return
  }
  if (scenario === 'mutation-error') {
    renderMutationError(root)
    return
  }
  if (scenario === 'mutation-state') {
    renderMutationState(root)
    return
  }
  if (scenario === 'action-state') {
    renderActionState(root)
    return
  }
  if (scenario === 'prefetch') {
    renderPrefetch(root)
    return
  }
  if (scenario === 'public-api') {
    renderPublicApi(root)
    return
  }
  if (scenario === 'enabled-query') {
    renderEnabledQuery(root)
    return
  }
  if (scenario === 'reactive-query') {
    renderReactiveQuery(root)
    return
  }
  if (scenario === 'throw-query') {
    renderThrowingQuery(root)
    return
  }
  if (scenario === 'pagination') {
    renderPagination(root)
    return
  }
  if (scenario === 'auth-options') {
    renderAuth(root)
    return
  }
  renderConnection(root)
})

function renderAuth(element: HTMLElement) {
  const query = createQuery(client, api.fixture.getIdentity, { args: {} })
  const output = document.createElement('p')

  createEffect(() => {
    const snapshot = query()
    output.textContent = `Identity: ${snapshot.status === 'success' ? (snapshot.data?.name ?? 'anonymous') : snapshot.status}`
  })
  element.append(output)
}

function renderPagination(element: HTMLElement) {
  const query = createQuery(client, api.fixture.paginateLabels, {
    args: { prefix: 'solid' },
    pagination: { initialNumItems: 2 }
  })
  const output = document.createElement('p')
  const button = document.createElement('button')
  button.textContent = 'Load more'
  button.addEventListener('click', () => query().loadMore(3))
  createEffect(() => {
    output.textContent = `Pagination: ${query().data?.join(', ')}`
    button.disabled = !query().canLoadMore
  })
  element.replaceChildren(output, button)
}

function renderEnabledQuery(element: HTMLElement) {
  const [enabled, setEnabled] = createSignal(false)
  const query = createQuery(client, getValue, {
    args: { key: 'solid-enabled', runId },
    enabled
  })
  const output = document.createElement('p')
  const button = document.createElement('button')

  button.type = 'button'
  button.textContent = 'Enable query'
  button.addEventListener('click', () => {
    setEnabled((value) => !value)
    button.textContent = enabled() ? 'Disable query' : 'Enable query'
  })
  createEffect(() => {
    output.textContent = `Enabled query: ${query().status}`
  })
  element.append(output, button)
}

function renderReactiveQuery(element: HTMLElement) {
  const [key, setKey] = createSignal<string | undefined>()
  const query = createQuery(client, getValue, {
    args: () => (key() === undefined ? 'skip' : { key: key() as string, runId })
  })
  const output = document.createElement('p')
  const load = document.createElement('button')
  const switchQuery = document.createElement('button')
  const skip = document.createElement('button')
  load.textContent = 'Load first arguments'
  switchQuery.textContent = 'Switch arguments'
  skip.textContent = 'Skip query'
  load.addEventListener('click', () => setKey('solid-first'))
  switchQuery.addEventListener('click', () => setKey('solid-second'))
  skip.addEventListener('click', () => setKey())
  createEffect(() => {
    output.textContent = `Reactive query: ${String(key())}, ${query().status}`
  })
  element.append(output, load, switchQuery, skip)
}

function renderThrowingQuery(element: HTMLElement) {
  const query = createQuery(client, api.fixture.throwQueryError, {
    args: {},
    throwOnError: true
  })
  catchError(
    () => {
      createEffect(() => {
        element.textContent = query().status
      })
    },
    (error) => {
      element.textContent = `Boundary: ${error.message}`
    }
  )
}

function renderConnection(element: HTMLElement) {
  const query = createQuery(client, getValue, {
    args: { key: 'solid-connection', runId }
  })

  createEffect(() => {
    element.textContent =
      query().status === 'success' ? 'Connected to Convex' : query().status
  })
}

function renderOptimistic(element: HTMLElement) {
  const key = 'solid-optimistic'
  const [hookChange, setHookChange] = createSignal('none')
  const [optionChange, setOptionChange] = createSignal('none')
  const query = createQuery(client, getValue, {
    args: { key, runId },
    onDataChange: ({ next, previous }) =>
      setOptionChange(`${previous} -> ${next}`),
    select: String
  })
  createOnDataChange(query, ({ next, previous }) =>
    setHookChange(`${previous} -> ${next}`)
  )
  const updateValue = createMutation(client, setValue, {
    optimistic: ({ data, store }) =>
      store
        .get(getValue, { key: data.key, runId: data.runId })
        .modify(data.value)
  })
  const queryOutput = document.createElement('p')
  const mutationOutput = document.createElement('p')
  const optionOutput = document.createElement('p')
  const hookOutput = document.createElement('p')
  const button = document.createElement('button')

  button.type = 'button'
  button.textContent = 'Update value'
  mutationOutput.textContent = 'Mutation: not called'
  button.addEventListener('click', () => {
    async function update() {
      const result = await updateValue({
        key,
        runId,
        value: 'changed in Solid'
      })

      mutationOutput.textContent = `Mutation: ${String(result)}`
    }

    void update()
  })
  createEffect(() => {
    const snapshot = query()

    queryOutput.textContent = `Query: ${snapshot.status === 'success' ? String(snapshot.data) : snapshot.status}`
    optionOutput.textContent = `Option changes: ${optionChange()}`
    hookOutput.textContent = `Hook changes: ${hookChange()}`
  })
  element.append(queryOutput, mutationOutput, optionOutput, hookOutput, button)
}

function renderQueryError(element: HTMLElement) {
  const query = createQuery(client, api.fixture.throwQueryError, { args: {} })

  createEffect(() => {
    const snapshot = query()

    element.textContent =
      snapshot.status === 'error' ? snapshot.error.message : snapshot.status
  })
}

function renderMutationError(element: HTMLElement) {
  const fail = createMutation(client, api.fixture.throwMutationError)
  const output = document.createElement('p')
  const stateOutput = document.createElement('p')
  const button = document.createElement('button')

  output.textContent = 'Mutation error: not called'
  button.type = 'button'
  button.textContent = 'Fail mutation'
  button.addEventListener('click', () => {
    async function runFailure() {
      try {
        await fail()
      } catch (error) {
        output.textContent = `Mutation error: ${errorMessage(error)}`
      }
    }

    void runFailure()
  })
  createEffect(() => {
    stateOutput.textContent = `Observable error: ${fail.status}, ${fail.error?.message ?? ''}`
  })
  element.append(output, stateOutput, button)
}

function renderMutationState(element: HTMLElement) {
  const [events, setEvents] = createSignal<string[]>([])
  const mutation = createMutation(client, setValue, {
    onMutate: () => setEvents((current) => [...current, 'mutate']),
    onSettled: ({ error }) =>
      setEvents((current) => [
        ...current,
        error === null ? 'settled:success' : 'settled:error'
      ]),
    onSuccess: ({ data }) =>
      setEvents((current) => [...current, `success:${data}`])
  })
  const output = document.createElement('p')
  const eventOutput = document.createElement('p')
  const start = document.createElement('button')
  const complete = document.createElement('button')
  const reset = document.createElement('button')
  start.textContent = 'Start mutation'
  complete.textContent = 'Complete mutation'
  reset.textContent = 'Reset mutation'
  start.addEventListener('click', () => {
    client.setAuth(
      () =>
        new Promise<string | null>((resolve) => {
          globalThis.setTimeout(() => resolve(null), 60_000)
        })
    )
    void mutation({
      key: 'mutation-state',
      runId,
      value: 'observable Solid mutation'
    })
  })
  complete.addEventListener('click', () => client.clearAuth())
  reset.addEventListener('click', mutation.reset)
  createEffect(() => {
    output.textContent = `Mutation state: ${mutation.status}, ${String(mutation.isPending)}, ${String(mutation.data)}`
    eventOutput.textContent = `Mutation events: ${events().join(', ')}`
  })
  element.append(output, eventOutput, start, complete, reset)
}

function renderActionState(element: HTMLElement) {
  const [event, setEvent] = createSignal('none')
  const action = createAction(client, api.fixture.echoAction, {
    onSuccess: ({ data }) => setEvent(`success:${String(data)}`)
  })
  const output = document.createElement('p')
  const eventOutput = document.createElement('p')
  const run = document.createElement('button')
  const reset = document.createElement('button')
  run.textContent = 'Run action hook'
  reset.textContent = 'Reset action hook'
  run.addEventListener('click', () => {
    void action({ value: 'observable Solid action' })
  })
  reset.addEventListener('click', action.reset)
  createEffect(() => {
    output.textContent = `Action state: ${action.status}, ${String(action.isPending)}, ${String(action.data)}`
    eventOutput.textContent = `Action event: ${event()}`
  })
  element.append(output, eventOutput, run, reset)
}

function renderPrefetch(element: HTMLElement) {
  const prefetch = createPrefetchQuery(client, getValue)
  const output = document.createElement('p')
  const button = document.createElement('button')

  output.textContent = 'Prefetch: not called'
  button.type = 'button'
  button.textContent = 'Prefetch value'
  button.addEventListener('click', () => {
    async function runPrefetch() {
      const handle = prefetch({ key: 'solid-prefetch', runId })

      output.textContent = `Prefetch: ${String(await handle.ready)}`
    }

    void runPrefetch()
  })
  element.append(output, button)
}

function renderPublicApi(element: HTMLElement) {
  async function loadPublicApi() {
    const publicApi = await import('convex-pulse/solid')

    element.textContent = Object.keys(publicApi).toSorted().join(', ')
  }

  void loadPublicApi()
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function fetchClerkToken(_options: { forceRefreshToken: boolean }) {
  return Promise.resolve(import.meta.env.VITE_CLERK_E2E_TOKEN)
}
