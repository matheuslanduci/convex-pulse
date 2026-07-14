import { mountConvexPulseDevtools } from 'convex-pulse/devtools'
import {
  ConvexPulseSvelteClient,
  createAction,
  createMutation,
  createPrefetchQuery,
  createQuery,
  initConvex,
  onDataChange
} from 'convex-pulse/svelte'
import type { FunctionReference } from 'convex/server'
import { mount } from 'svelte'
import { writable } from 'svelte/store'

import { api } from '#convex/api'

import ReactiveLifecycle from './ReactiveLifecycle.svelte'

const scenario = new URLSearchParams(location.search).get('scenario')
const client =
  scenario === 'reactive-lifecycle'
    ? initConvex(import.meta.env.VITE_CONVEX_URL)
    : new ConvexPulseSvelteClient(
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
  throw new Error('Missing Svelte root')
}

if (scenario === 'reactive-lifecycle') {
  mount(ReactiveLifecycle, { props: { client, runId }, target: root })
} else if (scenario === 'optimistic') {
  renderOptimistic(root)
} else if (scenario === 'query-error') {
  renderQueryError(root)
} else if (scenario === 'mutation-error') {
  renderMutationError(root)
} else if (scenario === 'mutation-state') {
  renderMutationState(root)
} else if (scenario === 'action-state') {
  renderActionState(root)
} else if (scenario === 'prefetch') {
  renderPrefetch(root)
} else if (scenario === 'public-api') {
  renderPublicApi(root)
} else if (scenario === 'enabled-query') {
  renderEnabledQuery(root)
} else if (scenario === 'pagination') {
  renderPagination(root)
} else if (scenario === 'auth-options') {
  renderAuth(root)
} else {
  renderConnection(root)
}

function renderAuth(element: HTMLElement) {
  const query = createQuery(client, api.fixture.getIdentity, { args: {} })
  const output = document.createElement('p')

  query.subscribe((snapshot) => {
    output.textContent = `Identity: ${snapshot.status === 'success' ? (snapshot.data?.name ?? 'anonymous') : snapshot.status}`
  })
  element.append(output)
}

function renderPagination(element: HTMLElement) {
  const query = createQuery(client, api.fixture.paginateLabels, {
    args: { prefix: 'svelte' },
    pagination: { initialNumItems: 2 }
  })
  const output = document.createElement('p')
  const button = document.createElement('button')
  let loadMore: (numItems: number) => void = noop
  button.textContent = 'Load more'
  button.addEventListener('click', () => loadMore(3))
  query.subscribe((snapshot) => {
    const { loadMore: nextLoadMore } = snapshot
    output.textContent = `Pagination: ${snapshot.data?.join(', ')}`
    button.disabled = !snapshot.canLoadMore
    loadMore = nextLoadMore
  })
  element.replaceChildren(output, button)
}

function noop() {
  // Pagination has not loaded its first page yet.
}

function renderEnabledQuery(element: HTMLElement) {
  const enabled = writable(false)
  const query = createQuery(client, getValue, {
    args: { key: 'svelte-enabled', runId },
    enabled
  })
  const output = document.createElement('p')
  const button = document.createElement('button')
  let currentEnabled = false

  button.type = 'button'
  button.textContent = 'Enable query'
  button.addEventListener('click', () => {
    currentEnabled = !currentEnabled
    enabled.set(currentEnabled)
    button.textContent = currentEnabled ? 'Disable query' : 'Enable query'
  })
  query.subscribe((snapshot) => {
    output.textContent = `Enabled query: ${snapshot.status}`
  })
  element.append(output, button)
}

function renderConnection(element: HTMLElement) {
  const query = createQuery(client, getValue, {
    args: { key: 'svelte-connection', runId }
  })

  query.subscribe((snapshot) => {
    if (snapshot.status === 'pending' || snapshot.status === 'error') {
      element.textContent = snapshot.status
      return
    }

    element.dataset.value = snapshot.data
    element.textContent = 'Connected to Convex'
  })
}

function renderOptimistic(element: HTMLElement) {
  const key = 'svelte-optimistic'
  const optionOutput = document.createElement('p')
  const hookOutput = document.createElement('p')
  optionOutput.textContent = 'Option changes: none'
  hookOutput.textContent = 'Hook changes: none'
  const query = createQuery(client, getValue, {
    args: { key, runId },
    onDataChange: ({ next, previous }) => {
      optionOutput.textContent = `Option changes: ${previous} -> ${next}`
    },
    select: String
  })
  onDataChange(query, ({ next, previous }) => {
    hookOutput.textContent = `Hook changes: ${previous} -> ${next}`
  })
  const updateValue = createMutation(client, setValue, {
    optimistic: ({ data, store }) =>
      store
        .get(getValue, { key: data.key, runId: data.runId })
        .modify(data.value)
  })
  const queryOutput = document.createElement('p')
  const mutationOutput = document.createElement('p')
  const button = document.createElement('button')

  button.type = 'button'
  button.textContent = 'Update value'
  mutationOutput.textContent = 'Mutation: not called'
  button.addEventListener('click', () => {
    async function update() {
      const result = await updateValue({
        key,
        runId,
        value: 'changed in Svelte'
      })

      mutationOutput.textContent = `Mutation: ${String(result)}`
    }

    void update()
  })
  query.subscribe((snapshot) => {
    queryOutput.textContent = `Query: ${snapshot.status === 'success' ? String(snapshot.data) : snapshot.status}`
  })
  element.append(queryOutput, mutationOutput, optionOutput, hookOutput, button)
}

function renderQueryError(element: HTMLElement) {
  const query = createQuery(client, api.fixture.throwQueryError, { args: {} })

  query.subscribe((snapshot) => {
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
  fail.subscribe((snapshot) => {
    stateOutput.textContent = `Observable error: ${snapshot.status}, ${snapshot.error?.message ?? ''}`
  })
  element.append(output, stateOutput, button)
}

function renderMutationState(element: HTMLElement) {
  const events: string[] = []
  const eventOutput = document.createElement('p')
  function addEvent(event: string) {
    events.push(event)
    eventOutput.textContent = `Mutation events: ${events.join(', ')}`
  }
  const mutation = createMutation(client, setValue, {
    onMutate: () => addEvent('mutate'),
    onSettled: ({ error }) =>
      addEvent(error === null ? 'settled:success' : 'settled:error'),
    onSuccess: ({ data }) => addEvent(`success:${data}`)
  })
  const output = document.createElement('p')
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
      value: 'observable Svelte mutation'
    })
  })
  complete.addEventListener('click', () => client.clearAuth())
  reset.addEventListener('click', mutation.reset)
  mutation.subscribe((snapshot) => {
    output.textContent = `Mutation state: ${snapshot.status}, ${String(snapshot.isPending)}, ${String(snapshot.data)}`
    eventOutput.textContent = `Mutation events: ${events.join(', ')}`
  })
  element.append(output, eventOutput, start, complete, reset)
}

function renderActionState(element: HTMLElement) {
  const eventOutput = document.createElement('p')
  const action = createAction(client, api.fixture.echoAction, {
    onSuccess: ({ data }) => {
      eventOutput.textContent = `Action event: success:${String(data)}`
    }
  })
  const output = document.createElement('p')
  const run = document.createElement('button')
  const reset = document.createElement('button')
  eventOutput.textContent = 'Action event: none'
  run.textContent = 'Run action hook'
  reset.textContent = 'Reset action hook'
  run.addEventListener('click', () => {
    void action({ value: 'observable Svelte action' })
  })
  reset.addEventListener('click', action.reset)
  action.subscribe((snapshot) => {
    output.textContent = `Action state: ${snapshot.status}, ${String(snapshot.isPending)}, ${String(snapshot.data)}`
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
      const handle = prefetch({ key: 'svelte-prefetch', runId })

      output.textContent = `Prefetch: ${String(await handle.ready)}`
    }

    void runPrefetch()
  })
  element.append(output, button)
}

function renderPublicApi(element: HTMLElement) {
  async function loadPublicApi() {
    const publicApi = await import('convex-pulse/svelte')

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
