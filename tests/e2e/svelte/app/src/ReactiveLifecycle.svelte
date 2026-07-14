<script lang="ts">
  import {
    setConvexClientContext,
    setupAuth,
    useAction,
    useAuth,
    useMutation,
    usePaginatedQuery,
    usePrefetchQuery,
    useQuery
  } from 'convex-pulse/svelte'

  import { api } from '#convex/api'

  const { client, runId }: Props = $props()
  const state = $state<{ key: string | undefined; signedIn: boolean }>({
    key: undefined,
    signedIn: false
  })

  setConvexClientContext(client)
  setupAuth(() => ({
    fetchAccessToken: () =>
      Promise.resolve(
        state.signedIn ? import.meta.env.VITE_CLERK_E2E_TOKEN : null
      ),
    isAuthenticated: state.signedIn,
    isLoading: false
  }))
  const auth = useAuth()
  const value = useQuery(api.fixture.getValue, () =>
    state.key === undefined ? 'skip' : { key: state.key, runId }
  )
  const labels = usePaginatedQuery(
    api.fixture.paginateLabels,
    { prefix: 'rune' },
    { initialNumItems: 2 }
  )
  const mutation = useMutation(api.fixture.setValue)
  const action = useAction(api.fixture.echoAction)
  const prefetch = usePrefetchQuery(api.fixture.getValue)
  const prefetchState = $state<{ value: unknown }>({ value: null })
</script>

<p>Reactive query: {value.status}</p>
<p>Reactive value: {String(value.data)}</p>
<p>
  Reactive auth: {auth.isLoading
    ? 'loading'
    : auth.isAuthenticated
      ? 'authenticated'
      : 'anonymous'}
</p>
<p>Rune pagination: {labels.data?.join(', ')}</p>
<p>Rune mutation: {$mutation.status}, {String($mutation.data)}</p>
<p>Rune action: {$action.status}, {String($action.data)}</p>
<p>Rune prefetch: {String(prefetchState.value)}</p>
<button type="button" onclick={() => (state.key = 'reactive')}>Load reactive query</button>
<button type="button" onclick={() => (state.key = undefined)}>Skip reactive query</button>
<button type="button" onclick={() => (state.signedIn = true)}>Sign in reactively</button>
<button type="button" onclick={() => (state.signedIn = false)}>Sign out reactively</button>
<button type="button" onclick={() => labels.loadMore(3)}>Load more rune labels</button>
<button
  type="button"
  onclick={() => void mutation({ key: 'rune', runId, value: 'rune mutation' })}
>Run rune mutation</button>
<button
  type="button"
  onclick={() => void action({ value: 'rune action' })}
>Run rune action</button>
<button
  type="button"
  onclick={() => void prefetch({ key: 'rune', runId }).ready.then((value) => (prefetchState.value = value))}
>Run rune prefetch</button>

<script lang="ts" module>
  import type { ConvexPulseSvelteClient } from 'convex-pulse/svelte'

  type Props = Readonly<{
    client: ConvexPulseSvelteClient
    runId: string
  }>
</script>
