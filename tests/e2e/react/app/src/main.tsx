import {
  ConvexPulseDevtools,
  ConvexPulseReactClient,
  ConvexPulseReactProvider,
  useAction,
  useMutation,
  useOnDataChange,
  usePrefetchQuery,
  useQuery
} from 'convex-pulse/react'
import type { OptimisticQuery } from 'convex-pulse/react'
import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { api } from '#convex/api'

const scenario = new URLSearchParams(location.search).get('scenario')
const client = new ConvexPulseReactClient(
  import.meta.env.VITE_CONVEX_URL,
  scenario === 'devtools' ? { gcTime: 1500 } : {}
)
const runId = crypto.randomUUID()
const devtoolsQueryKey = `devtools-query-${'detail-'.repeat(80)}`

function App() {
  return (
    <main>
      <h1>Convex Pulse</h1>
      {scenario === 'live-update' && <LiveUpdate />}
      {scenario === 'query-error' && <QueryError />}
      {scenario === 'mutation-error' && <MutationError />}
      {scenario === 'mutation-state' && <MutationState />}
      {scenario === 'action-state' && <ActionState />}
      {scenario === 'beforeunload' && <BeforeUnloadWarning />}
      {scenario === 'prefetch' && <Prefetch />}
      {scenario === 'auth' && <Authentication />}
      {scenario === 'auth-cache' && <AuthCacheIsolation />}
      {scenario === 'shared-query' && <SharedQuery />}
      {scenario === 'enabled-query' && <EnabledQuery />}
      {scenario === 'pagination' && <Pagination />}
      {scenario === 'public-api' && <PublicApi />}
      {scenario === 'devtools' && <DevtoolsDemo />}
      {scenario === null && <Connection />}
    </main>
  )
}

function Pagination() {
  const query = useQuery(api.fixture.paginateLabels, {
    args: { prefix: 'item' },
    pagination: { initialNumItems: 2 }
  })

  return (
    <section>
      <p>Pagination status: {query.status}</p>
      <p>Pagination loading: {query.isLoading ? 'yes' : 'no'}</p>
      <p>Pagination loading more: {query.isLoadingMore ? 'yes' : 'no'}</p>
      <p>Pagination data: {query.data?.join(', ')}</p>
      <p>Pagination more: {query.canLoadMore ? 'yes' : 'no'}</p>
      <button
        disabled={!query.canLoadMore}
        type="button"
        onClick={() => query.loadMore(3)}
      >
        Load more
      </button>
    </section>
  )
}

function EnabledQuery() {
  const [enabled, setEnabled] = useState(false)
  const query = useQuery(api.fixture.getValue, {
    args: { key: 'enabled-query', runId },
    enabled
  })

  return (
    <section>
      <p>Enabled query: {query.status}</p>
      <button type="button" onClick={() => setEnabled((value) => !value)}>
        {enabled ? 'Disable query' : 'Enable query'}
      </button>
    </section>
  )
}

function DevtoolsDemo() {
  const [actionResult, setActionResult] = useState('not called')
  const [queryMounted, setQueryMounted] = useState(true)
  const [mutationResult, setMutationResult] = useState('not called')
  const setValue = useMutation(api.fixture.setValue, {
    dedupe: ({ args }) => args.key,
    optimistic: ({ data, store }) => {
      const query = store.get(api.fixture.getValue, {
        key: data.key,
        runId: data.runId
      }) as OptimisticQuery<string>
      query.modify(String(data.value))
    }
  })

  async function queueMutation() {
    client.setAuth(
      () =>
        new Promise<string | null>((resolve) => {
          globalThis.setTimeout(() => resolve(null), 60_000)
        })
    )
    const input = {
      key: devtoolsQueryKey,
      runId,
      value: 'sent from DevTools demo'
    }
    const [value] = await Promise.all([setValue(input), setValue(input)])
    setMutationResult(String(value))
  }

  async function runAction() {
    const value = await client.action(api.fixture.echoAction, {
      value: 'sent from DevTools action'
    })
    setActionResult(String(value))
  }

  async function failAction() {
    try {
      await client.action(api.fixture.throwActionError, {})
    } catch (error) {
      setActionResult(errorMessage(error))
    }
  }

  return (
    <section>
      <ConvexPulseDevtools initialIsOpen position="top-right" />
      {queryMounted && <DevtoolsQuery />}
      <p>Mutation result: {mutationResult}</p>
      <p>Action result: {actionResult}</p>
      <button type="button" onClick={() => setQueryMounted(false)}>
        Unmount query
      </button>
      <button type="button" onClick={() => void queueMutation()}>
        Queue mutation
      </button>
      <button type="button" onClick={() => client.clearAuth()}>
        Send queued mutation
      </button>
      <button type="button" onClick={() => void runAction()}>
        Run action
      </button>
      <button type="button" onClick={() => void failAction()}>
        Fail action
      </button>
    </section>
  )
}

function DevtoolsQuery() {
  const query = useQuery(api.fixture.getValue, {
    args: { key: devtoolsQueryKey, runId }
  })

  return <p>DevTools query: {query.status}</p>
}

function Authentication() {
  return (
    <ConvexPulseReactProvider convex={client} fetchToken={fetchClerkToken}>
      <AuthenticationView />
    </ConvexPulseReactProvider>
  )
}

function AuthenticationView() {
  const requiredQuery = useQuery(api.fixture.getRequiredIdentity, { args: {} })
  const query = useQuery(api.fixture.getIdentity, { args: {} })
  const identity = query.status === 'success' ? query.data : undefined
  let auth: string = query.status
  if (query.status === 'success') {
    auth = identity === null ? 'anonymous' : 'authenticated'
  }

  return (
    <section>
      <p>Auth: {auth}</p>
      <p>Required auth: {requiredQuery.status}</p>
      <p>
        Identity:{' '}
        {query.status === 'success'
          ? (identity?.name ?? 'anonymous')
          : query.status}
      </p>
      <button type="button" onClick={() => client.clearAuth()}>
        Clear auth
      </button>
    </section>
  )
}

function fetchClerkToken(_options: { forceRefreshToken: boolean }) {
  return new Promise<string>((resolve) => {
    globalThis.setTimeout(
      () => resolve(import.meta.env.VITE_CLERK_E2E_TOKEN),
      300
    )
  })
}

function AuthCacheIsolation() {
  const [auth, setAuth] = useState('pending')
  const [history, setHistory] = useState<string[]>([])
  const [mounted, setMounted] = useState(true)
  const recordIdentity = useCallback(
    (identity: string) => {
      const entry = `${auth}:${identity}`
      setHistory((current) =>
        current.at(-1) === entry ? current : [...current, entry]
      )
    },
    [auth]
  )

  useEffect(() => {
    client.setAuth(
      () => Promise.resolve(import.meta.env.VITE_CLERK_E2E_TOKEN),
      {
        onChange: (authenticated) =>
          setAuth(authenticated ? 'authenticated' : 'anonymous')
      }
    )
    return () => client.clearAuth()
  }, [])

  return (
    <section>
      <p>Auth cache: {auth}</p>
      <p>Identity history: {history.join(' | ')}</p>
      {mounted && <RecordedIdentity onRender={recordIdentity} />}
      <button type="button" onClick={() => setMounted(false)}>
        Unsubscribe identity
      </button>
      <button type="button" onClick={() => client.clearAuth()}>
        Clear cached auth
      </button>
      <button type="button" onClick={() => setMounted(true)}>
        Resubscribe identity
      </button>
    </section>
  )
}

function RecordedIdentity({
  onRender
}: Readonly<{ onRender: (identity: string) => void }>) {
  const query = useQuery(api.fixture.getIdentity, { args: {} })
  const identity =
    query.status === 'success'
      ? (query.data?.name ?? 'anonymous')
      : query.status

  useEffect(() => onRender(identity), [identity, onRender])

  return <p>Cached identity: {identity}</p>
}

function PublicApi() {
  const [runtimeExports, setRuntimeExports] = useState('loading')

  useEffect(() => {
    async function loadRuntimeExports() {
      const publicApi = await import('convex-pulse/react')

      setRuntimeExports(Object.keys(publicApi).toSorted().join(', '))
    }

    void loadRuntimeExports()
  }, [])

  return <p>Runtime exports: {runtimeExports}</p>
}

function Connection() {
  const query = useQuery(api.fixture.getValue, {
    args: { key: 'react-connection-check', runId }
  })

  if (query.status === 'pending') {
    return <p>Connecting…</p>
  }
  if (query.status === 'error') {
    return <p role="alert">{query.error.message}</p>
  }
  return <p>Connected to Convex</p>
}

function SharedQuery() {
  return (
    <section>
      <SharedQueryValue label="First" />
      <SharedQueryValue label="Second" />
    </section>
  )
}

function SharedQueryValue({ label }: Readonly<{ label: string }>) {
  const query = useQuery(api.fixture.getValue, {
    args: { key: 'shared-query', runId }
  })

  return (
    <p>
      {label}: {query.status === 'success' ? String(query.data) : query.status}
    </p>
  )
}

function LiveUpdate() {
  const [hookChanges, setHookChanges] = useState<string[]>([])
  const [optionChanges, setOptionChanges] = useState<string[]>([])
  const query = useQuery(api.fixture.getValue, {
    args: { key: 'live-update', runId },
    onDataChange: ({ next, previous }) =>
      setOptionChanges((changes) => [...changes, `${previous} -> ${next}`]),
    select: String
  })
  useOnDataChange(query, ({ next, previous }) =>
    setHookChanges((changes) => [...changes, `${previous} -> ${next}`])
  )
  const setValue = useMutation(api.fixture.setValue)
  const [mutationResult, setMutationResult] = useState('not called')

  async function updateValue() {
    const result = await setValue({
      key: 'live-update',
      runId,
      value: 'changed in React'
    })
    setMutationResult(String(result))
  }

  return (
    <section>
      <p>
        Query: {query.status === 'success' ? String(query.data) : query.status}
      </p>
      <p>Mutation: {mutationResult}</p>
      <p>Option changes: {optionChanges.join(' | ') || 'none'}</p>
      <p>Hook changes: {hookChanges.join(' | ') || 'none'}</p>
      <button type="button" onClick={() => void updateValue()}>
        Update value
      </button>
    </section>
  )
}

function QueryError() {
  const query = useQuery(api.fixture.throwQueryError, { args: {} })

  if (query.status === 'error') {
    return <p role="alert">{query.error.message}</p>
  }
  return <p>{query.status}</p>
}

function MutationError() {
  const fail = useMutation(api.fixture.throwMutationError)
  const setValue = useMutation(api.fixture.setValue)
  const [mutationError, setMutationError] = useState('not called')
  const [recovery, setRecovery] = useState('not called')

  async function failThenRecover() {
    try {
      await fail()
    } catch (error) {
      setMutationError(errorMessage(error))
    }
    const result = await setValue({
      key: 'after-mutation-error',
      runId,
      value: 'still open'
    })
    setRecovery(String(result))
  }

  return (
    <section>
      <p>Mutation error: {mutationError}</p>
      <p>
        Observable error: {fail.status}, {fail.error?.message}
      </p>
      <p>Recovery: {recovery}</p>
      <button type="button" onClick={() => void failThenRecover()}>
        Fail then recover
      </button>
    </section>
  )
}

function MutationState() {
  const [events, setEvents] = useState<string[]>([])
  const setValue = useMutation(api.fixture.setValue, {
    onMutate: () => setEvents((current) => [...current, 'mutate']),
    onSettled: ({ error }) =>
      setEvents((current) => [
        ...current,
        error === null ? 'settled:success' : 'settled:error'
      ]),
    onSuccess: ({ data }) =>
      setEvents((current) => [...current, `success:${data}`])
  })

  function startMutation() {
    client.setAuth(
      () =>
        new Promise<string | null>((resolve) => {
          globalThis.setTimeout(() => resolve(null), 60_000)
        })
    )
    void setValue({
      key: 'mutation-state',
      runId,
      value: 'observable React mutation'
    })
  }

  return (
    <section>
      <p>{`Mutation state: ${setValue.status}, ${String(setValue.isPending)}, ${String(setValue.data)}`}</p>
      <p>Mutation events: {events.join(', ')}</p>
      <button type="button" onClick={startMutation}>
        Start mutation
      </button>
      <button type="button" onClick={() => client.clearAuth()}>
        Complete mutation
      </button>
      <button type="button" onClick={setValue.reset}>
        Reset mutation
      </button>
    </section>
  )
}

function ActionState() {
  const [event, setEvent] = useState('none')
  const action = useAction(api.fixture.echoAction, {
    onSuccess: ({ data }) => setEvent(`success:${String(data)}`)
  })

  return (
    <section>
      <p>{`Action state: ${action.status}, ${String(action.isPending)}, ${String(action.data)}`}</p>
      <p>Action event: {event}</p>
      <button
        type="button"
        onClick={() => void action({ value: 'observable React action' })}
      >
        Run action hook
      </button>
      <button type="button" onClick={action.reset}>
        Reset action hook
      </button>
    </section>
  )
}

function BeforeUnloadWarning() {
  const mutation = useMutation(api.fixture.setValue)
  const action = useAction(api.fixture.echoAction)

  function startPendingWork() {
    client.setAuth(
      () =>
        new Promise<string | null>((resolve) => {
          globalThis.setTimeout(() => resolve(null), 60_000)
        })
    )
    void mutation({
      key: 'beforeunload',
      runId,
      value: 'mutation complete'
    })
    void action({ value: 'action complete' })
  }

  return (
    <section>
      <p>Mutation pending: {mutation.isPending ? 'yes' : 'no'}</p>
      <p>Action pending: {action.isPending ? 'yes' : 'no'}</p>
      <button type="button" onClick={startPendingWork}>
        Start pending work
      </button>
      <button type="button" onClick={() => client.clearAuth()}>
        Complete pending work
      </button>
    </section>
  )
}

function Prefetch() {
  const prefetch = usePrefetchQuery(api.fixture.getValue)
  const [result, setResult] = useState('not called')

  async function prefetchValue() {
    const handle = prefetch({ key: 'prefetch', runId })
    setResult(String(await handle.ready))
  }

  return (
    <section>
      <p>Prefetch: {result}</p>
      <button type="button" onClick={() => void prefetchValue()}>
        Prefetch value
      </button>
    </section>
  )
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

const root = document.querySelector('#root')
if (!root) {
  throw new Error('Missing React root')
}

createRoot(root).render(
  <StrictMode>
    <ConvexPulseReactProvider convex={client}>
      <App />
    </ConvexPulseReactProvider>
  </StrictMode>
)
