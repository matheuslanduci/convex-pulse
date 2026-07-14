import {
  ConvexPulseVueClient,
  ConvexPulseVueClientKey,
  useMutation as usePulseMutation,
  useQuery as usePulseQuery
} from 'convex-pulse/vue'
import {
  convexVue,
  useConvexClient,
  useConvexMutation,
  useConvexQuery
} from 'convex-vue'
import { createApp, defineComponent, h, ref, watchPostEffect } from 'vue'

import { api } from '#benchmark/api'

const parameterList = new URLSearchParams(location.search)
const clientKind = parameterList.get('client')
const input = {
  iteration: Number(parameterList.get('iteration')),
  payload: parameterList.get('payload') ?? ''
}
const deploymentUrl = import.meta.env.VITE_CONVEX_URL
const token = import.meta.env.VITE_BENCHMARK_TOKEN

const convexVueBenchmark = defineComponent({
  setup() {
    const client = useConvexClient()

    client.setAuth(() => Promise.resolve(token))
    const query = useConvexQuery(api.benchmark.echoQuery, input)
    const mutation = useConvexMutation(api.benchmark.echoMutation)
    const mutationOutput = ref<BenchmarkOutput | null>(null)

    useQueryTiming(() => query.data.value)
    useMutationTiming(() => mutationOutput.value)

    async function runMutation() {
      window.__benchmarkMutationStartedAt = performance.now()
      mutationOutput.value = await mutation.mutate({
        ...input,
        iteration: input.iteration + 1
      })
    }

    return () =>
      benchmarkView(query.data.value, mutationOutput.value, runMutation)
  }
})

const convexPulseBenchmark = defineComponent({
  setup() {
    const query = usePulseQuery(api.benchmark.echoQuery, { args: input })
    const mutate = usePulseMutation(api.benchmark.echoMutation)
    const mutationOutput = ref<BenchmarkOutput | null>(null)

    useQueryTiming(() =>
      query.value.status === 'success' ? query.value.data : undefined
    )
    useMutationTiming(() => mutationOutput.value)

    async function runMutation() {
      window.__benchmarkMutationStartedAt = performance.now()
      mutationOutput.value = await mutate({
        ...input,
        iteration: input.iteration + 1
      })
    }

    return () =>
      benchmarkView(
        query.value.status === 'success' ? query.value.data : undefined,
        mutationOutput.value,
        runMutation
      )
  }
})

function benchmarkView(
  queryOutput: BenchmarkOutput | undefined,
  mutationOutput: BenchmarkOutput | null,
  runMutation: () => Promise<void>
) {
  return h('main', [
    h(
      'p',
      { 'data-testid': 'query-result' },
      queryOutput === undefined ? 'pending' : queryOutput.iteration
    ),
    h(
      'p',
      { 'data-testid': 'mutation-result' },
      mutationOutput === null ? 'pending' : mutationOutput.iteration
    ),
    h('button', { onClick: () => void runMutation(), type: 'button' }, [
      'Run mutation'
    ])
  ])
}

function useQueryTiming(output: () => BenchmarkOutput | undefined) {
  watchPostEffect(() => {
    if (
      output() !== undefined &&
      window.__benchmarkQueryDurationMs === undefined
    ) {
      window.__benchmarkQueryDurationMs =
        performance.now() - window.__benchmarkNavigationStartedAt
    }
  })
}

function useMutationTiming(output: () => BenchmarkOutput | null) {
  watchPostEffect(() => {
    if (
      output() !== null &&
      window.__benchmarkMutationStartedAt !== undefined
    ) {
      window.__benchmarkMutationDurationMs =
        performance.now() - window.__benchmarkMutationStartedAt
    }
  })
}

function renderApp() {
  if (deploymentUrl === undefined || token === undefined) {
    throw new Error('VITE_CONVEX_URL and VITE_BENCHMARK_TOKEN are required')
  }

  if (clientKind === 'convex-vue') {
    const app = createApp(convexVueBenchmark)

    app.use(convexVue, { url: deploymentUrl })
    app.mount('#root')
    return
  }
  if (clientKind === 'convex-pulse') {
    const client = new ConvexPulseVueClient(deploymentUrl)
    const app = createApp(convexPulseBenchmark)

    client.setAuth(() => Promise.resolve(token))
    app.provide(ConvexPulseVueClientKey, client)
    app.mount('#root')
    return
  }

  throw new Error('Expected client to be "convex-vue" or "convex-pulse"')
}

renderApp()

type BenchmarkOutput = Readonly<{
  iteration: number
  payload: string
  serverTimestamp: number
}>

declare global {
  // eslint-disable-next-line typescript/consistent-type-definitions -- Global Window augmentation requires an interface.
  interface Window {
    __benchmarkMutationDurationMs?: number
    __benchmarkMutationStartedAt?: number
    __benchmarkNavigationStartedAt: number
    __benchmarkQueryDurationMs?: number
  }
}
