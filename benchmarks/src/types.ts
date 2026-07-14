export type BenchmarkClient = Readonly<{
  action: (input: BenchmarkInput) => Promise<BenchmarkOutput>
  close: () => Promise<void>
  mutation: (input: BenchmarkInput) => Promise<BenchmarkOutput>
  query: (input: BenchmarkInput) => Promise<BenchmarkOutput>
}>

export type BenchmarkAuthTokenFetcher = () => Promise<string>

export type BenchmarkClientKind = 'convex-js' | 'convex-pulse'

export type BenchmarkConfig = Readonly<{
  concurrency: number
  latencyIterations: number
  payloadBytes: number
  throughputOperations: number
  warmupIterations: number
}>

export type BenchmarkInput = Readonly<{
  iteration: number
  payload: string
}>

export type BenchmarkOutput = Readonly<{
  iteration: number
  payload: string
  serverTimestamp: number
}>

export type BenchmarkOperation = 'query' | 'mutation' | 'action'

export type LatencySummary = Readonly<{
  cpuMicrosecondsPerOperation: number
  meanMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
}>

export type MemorySnapshot = Readonly<{
  heapUsedBytes: number
  rssBytes: number
}>

export type MemorySummary = Readonly<{
  clientBaselineDelta: MemorySnapshot
  peakWorkloadDelta: MemorySnapshot
  retainedAfterCloseDelta: MemorySnapshot
}>

export type OperationResult = Readonly<{
  latency: LatencySummary
  operation: BenchmarkOperation
  phaseTiming: OperationPhaseTiming
  throughputCpuMicrosecondsPerOperation: number
  throughputOpsPerSecond: number
}>

export type OperationPhaseTiming = Readonly<{
  latencySetupMicrosecondsPerOperation: number
  latencyToServerMicrosecondsPerOperation: number
  latencyFromServerMicrosecondsPerOperation: number
  latencyWaitMicrosecondsPerOperation: number
  throughputSetupMicrosecondsPerOperation: number
  throughputWaitMicrosecondsPerOperation: number
}>

export type WorkerResult = Readonly<{
  client: BenchmarkClientKind
  config: BenchmarkConfig
  memory: MemorySummary
  nodeVersion: string
  operations: readonly OperationResult[]
}>
