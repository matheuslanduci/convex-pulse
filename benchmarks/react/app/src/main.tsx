import {
  ConvexPulseReactClient,
  ConvexPulseReactProvider,
  useMutation as usePulseMutation,
  useQuery as usePulseQuery
} from 'convex-pulse/react'
import {
  ConvexProvider,
  ConvexReactClient,
  useMutation as useConvexMutation,
  useQuery as useConvexQuery
} from 'convex/react'
import { useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { api } from '#benchmark/api'

const parameterList = new URLSearchParams(location.search)
const clientKind = parameterList.get('client')
const input = {
  iteration: Number(parameterList.get('iteration')),
  payload: parameterList.get('payload') ?? ''
}
const deploymentUrl = import.meta.env.VITE_CONVEX_URL
const token = import.meta.env.VITE_BENCHMARK_TOKEN

function ConvexJsBenchmark() {
  const queryOutput = useConvexQuery(api.benchmark.echoQuery, input)
  const mutate = useConvexMutation(api.benchmark.echoMutation)
  const [mutationOutput, setMutationOutput] = useState<BenchmarkOutput | null>(
    null
  )

  useQueryTiming(queryOutput)
  useMutationTiming(mutationOutput)

  async function runMutation() {
    window.__benchmarkMutationStartedAt = performance.now()
    setMutationOutput(
      await mutate({ ...input, iteration: input.iteration + 1 })
    )
  }

  return (
    <BenchmarkView
      mutationOutput={mutationOutput}
      queryOutput={queryOutput}
      runMutation={runMutation}
    />
  )
}

function ConvexPulseBenchmark() {
  const query = usePulseQuery(api.benchmark.echoQuery, { args: input })
  const mutate = usePulseMutation(api.benchmark.echoMutation)
  const [mutationOutput, setMutationOutput] = useState<BenchmarkOutput | null>(
    null
  )
  const queryOutput = query.status === 'success' ? query.data : undefined

  useQueryTiming(queryOutput)
  useMutationTiming(mutationOutput)

  async function runMutation() {
    window.__benchmarkMutationStartedAt = performance.now()
    setMutationOutput(
      await mutate({ ...input, iteration: input.iteration + 1 })
    )
  }

  return (
    <BenchmarkView
      mutationOutput={mutationOutput}
      queryOutput={queryOutput}
      runMutation={runMutation}
    />
  )
}

function BenchmarkView({
  mutationOutput,
  queryOutput,
  runMutation
}: BenchmarkViewProps) {
  return (
    <main>
      <p data-testid="query-result">
        {queryOutput === undefined ? 'pending' : queryOutput.iteration}
      </p>
      <p data-testid="mutation-result">
        {mutationOutput === null ? 'pending' : mutationOutput.iteration}
      </p>
      <button type="button" onClick={() => void runMutation()}>
        Run mutation
      </button>
    </main>
  )
}

function useQueryTiming(output: BenchmarkOutput | undefined) {
  useLayoutEffect(() => {
    if (
      output !== undefined &&
      window.__benchmarkQueryDurationMs === undefined
    ) {
      window.__benchmarkQueryDurationMs =
        performance.now() - window.__benchmarkNavigationStartedAt
    }
  }, [output])
}

function useMutationTiming(output: BenchmarkOutput | null) {
  useLayoutEffect(() => {
    if (output !== null && window.__benchmarkMutationStartedAt !== undefined) {
      window.__benchmarkMutationDurationMs =
        performance.now() - window.__benchmarkMutationStartedAt
    }
  }, [output])
}

function renderApp() {
  const rootElement = document.querySelector('#root')
  if (rootElement === null) {
    throw new Error('Missing React root')
  }
  if (deploymentUrl === undefined || token === undefined) {
    throw new Error('VITE_CONVEX_URL and VITE_BENCHMARK_TOKEN are required')
  }

  if (clientKind === 'convex-js') {
    const client = new ConvexReactClient(deploymentUrl)

    client.setAuth(() => Promise.resolve(token))
    createRoot(rootElement).render(
      <ConvexProvider client={client}>
        <ConvexJsBenchmark />
      </ConvexProvider>
    )
    return
  }
  if (clientKind === 'convex-pulse') {
    const client = new ConvexPulseReactClient(deploymentUrl)

    client.setAuth(() => Promise.resolve(token))
    createRoot(rootElement).render(
      <ConvexPulseReactProvider convex={client}>
        <ConvexPulseBenchmark />
      </ConvexPulseReactProvider>
    )
    return
  }
  throw new Error('Expected client to be "convex-js" or "convex-pulse"')
}

renderApp()

type BenchmarkViewProps = Readonly<{
  mutationOutput: BenchmarkOutput | null
  queryOutput: BenchmarkOutput | undefined
  runMutation: () => Promise<void>
}>

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
