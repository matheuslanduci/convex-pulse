import { spawnSync } from 'node:child_process'
import process from 'node:process'

import type {
  BenchmarkClient,
  BenchmarkClientKind,
  BenchmarkConfig,
  BenchmarkInput,
  BenchmarkOperation,
  MemorySnapshot,
  OperationResult,
  WorkerResult
} from '#benchmark/types.js'

const operationList: readonly BenchmarkOperation[] = [
  'query',
  'mutation',
  'action'
]

function readPositiveInteger(name: string, fallback: number) {
  const raw = process.env[name]
  if (raw === undefined) {
    return fallback
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

function readConfig(): BenchmarkConfig {
  return {
    concurrency: readPositiveInteger('BENCHMARK_CONCURRENCY', 25),
    latencyIterations: readPositiveInteger('BENCHMARK_LATENCY_ITERATIONS', 100),
    payloadBytes: readPositiveInteger('BENCHMARK_PAYLOAD_BYTES', 128),
    throughputOperations: readPositiveInteger(
      'BENCHMARK_THROUGHPUT_OPERATIONS',
      500
    ),
    warmupIterations: readPositiveInteger('BENCHMARK_WARMUP_ITERATIONS', 25)
  }
}

function readClientKind(): BenchmarkClientKind {
  const [kind] = process.argv.slice(2)
  if (kind !== 'convex-js' && kind !== 'convex-pulse') {
    throw new Error('Expected client to be "convex-js" or "convex-pulse"')
  }
  return kind
}

function readDeploymentUrl() {
  const deploymentUrl = process.env.CONVEX_URL
  if (deploymentUrl === undefined) {
    throw new Error('CONVEX_URL is required')
  }
  return deploymentUrl
}

function createAuthTokenFetcher() {
  const secretKey = process.env.BENCHMARK_CLERK_SECRET_KEY
  const sessionId = process.env.BENCHMARK_CLERK_SESSION_ID
  if (secretKey === undefined || sessionId === undefined) {
    throw new Error(
      'BENCHMARK_CLERK_SECRET_KEY and BENCHMARK_CLERK_SESSION_ID are required'
    )
  }

  return () => Promise.resolve(createClerkToken(secretKey, sessionId))
}

function createClerkToken(secretKey: string, sessionId: string) {
  const result = spawnSync(
    'clerk',
    [
      'api',
      '--secret-key',
      secretKey,
      `/sessions/${sessionId}/tokens/convex`,
      '--method',
      'POST',
      '--yes'
    ],
    { encoding: 'utf-8' }
  )
  if (result.error !== undefined) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`Could not refresh Clerk token: ${result.stderr}`)
  }
  const token = JSON.parse(result.stdout).jwt
  if (typeof token !== 'string') {
    throw new TypeError('Clerk did not return a JWT')
  }
  return token
}

async function loadClientFactory(kind: BenchmarkClientKind) {
  if (kind === 'convex-js') {
    const module = await import('#benchmark/clients/convexJs.js')

    return module.createClient
  }
  const module = await import('#benchmark/clients/convexPulse.js')

  return module.createClient
}

function collectGarbage() {
  if (globalThis.gc === undefined) {
    throw new Error('The benchmark worker must run with --expose-gc')
  }
  for (let iteration = 0; iteration < 3; iteration += 1) {
    globalThis.gc()
  }
}

function memorySnapshot(): MemorySnapshot {
  const usage = process.memoryUsage()
  return {
    heapUsedBytes: usage.heapUsed,
    rssBytes: usage.rss
  }
}

function maximumMemory(
  left: MemorySnapshot,
  right: MemorySnapshot
): MemorySnapshot {
  return {
    heapUsedBytes: Math.max(left.heapUsedBytes, right.heapUsedBytes),
    rssBytes: Math.max(left.rssBytes, right.rssBytes)
  }
}

function subtractMemory(
  left: MemorySnapshot,
  right: MemorySnapshot
): MemorySnapshot {
  return {
    heapUsedBytes: left.heapUsedBytes - right.heapUsedBytes,
    rssBytes: left.rssBytes - right.rssBytes
  }
}

function nextInput(counter: IterationCounter, payload: string): BenchmarkInput {
  const input = { iteration: counter.value, payload }
  counter.value += 1
  return input
}

async function execute(
  client: BenchmarkClient,
  operation: BenchmarkOperation,
  input: BenchmarkInput
) {
  const setupStartedAt = performance.now()
  const wallStartedAt = Date.now()
  const pending = client[operation](input)
  const setupMilliseconds = performance.now() - setupStartedAt
  const waitStartedAt = performance.now()
  const output = await pending
  const wallFinishedAt = Date.now()
  const waitMilliseconds = performance.now() - waitStartedAt
  if (
    output.iteration !== input.iteration ||
    output.payload !== input.payload
  ) {
    throw new Error(`${operation} returned an unexpected result`)
  }
  return {
    fromServerMilliseconds: wallFinishedAt - output.serverTimestamp,
    setupMilliseconds,
    toServerMilliseconds: output.serverTimestamp - wallStartedAt,
    waitMilliseconds
  }
}

async function warmUp(
  client: BenchmarkClient,
  config: BenchmarkConfig,
  counter: IterationCounter,
  payload: string
) {
  for (const operation of operationList) {
    for (
      let iteration = 0;
      iteration < config.warmupIterations;
      iteration += 1
    ) {
      // eslint-disable-next-line no-await-in-loop -- Warmups must preserve one in-flight operation.
      await execute(client, operation, nextInput(counter, payload))
    }
  }
}

function percentile(
  sortedValueList: readonly number[],
  percentileValue: number
) {
  const index = Math.max(
    0,
    Math.ceil((percentileValue / 100) * sortedValueList.length) - 1
  )
  return sortedValueList[index] as number
}

async function measureLatency(
  client: BenchmarkClient,
  operation: BenchmarkOperation,
  config: BenchmarkConfig,
  counter: IterationCounter,
  payload: string
) {
  const durationList: number[] = []
  let setupMilliseconds = 0
  let toServerMilliseconds = 0
  let fromServerMilliseconds = 0
  let waitMilliseconds = 0
  const cpuStart = process.cpuUsage()
  for (
    let iteration = 0;
    iteration < config.latencyIterations;
    iteration += 1
  ) {
    const input = nextInput(counter, payload)
    const startedAt = performance.now()
    // eslint-disable-next-line no-await-in-loop -- Latency measures one operation at a time.
    const phaseTiming = await execute(client, operation, input)
    setupMilliseconds += phaseTiming.setupMilliseconds
    toServerMilliseconds += phaseTiming.toServerMilliseconds
    fromServerMilliseconds += phaseTiming.fromServerMilliseconds
    waitMilliseconds += phaseTiming.waitMilliseconds
    durationList.push(performance.now() - startedAt)
  }

  const sortedDurationList = durationList.toSorted(
    (left, right) => left - right
  )
  const total = durationList.reduce((sum, duration) => sum + duration, 0)
  const cpuUsage = process.cpuUsage(cpuStart)

  return {
    fromServerMicrosecondsPerOperation:
      (fromServerMilliseconds * 1000) / config.latencyIterations,
    latency: {
      cpuMicrosecondsPerOperation:
        (cpuUsage.user + cpuUsage.system) / config.latencyIterations,
      meanMs: total / durationList.length,
      p50Ms: percentile(sortedDurationList, 50),
      p95Ms: percentile(sortedDurationList, 95),
      p99Ms: percentile(sortedDurationList, 99)
    },
    setupMicrosecondsPerOperation:
      (setupMilliseconds * 1000) / config.latencyIterations,
    toServerMicrosecondsPerOperation:
      (toServerMilliseconds * 1000) / config.latencyIterations,
    waitMicrosecondsPerOperation:
      (waitMilliseconds * 1000) / config.latencyIterations
  }
}

async function measureThroughput(
  client: BenchmarkClient,
  operation: BenchmarkOperation,
  config: BenchmarkConfig,
  counter: IterationCounter,
  payload: string
) {
  let nextOperation = 0
  let setupMilliseconds = 0
  let waitMilliseconds = 0
  const cpuStart = process.cpuUsage()
  const startedAt = performance.now()
  const laneCount = Math.min(config.concurrency, config.throughputOperations)

  async function runLane() {
    while (nextOperation < config.throughputOperations) {
      nextOperation += 1
      // eslint-disable-next-line no-await-in-loop -- Each throughput lane is sequential by design.
      const phaseTiming = await execute(
        client,
        operation,
        nextInput(counter, payload)
      )
      setupMilliseconds += phaseTiming.setupMilliseconds
      waitMilliseconds += phaseTiming.waitMilliseconds
    }
  }

  await Promise.all(Array.from({ length: laneCount }, () => runLane()))
  const durationSeconds = (performance.now() - startedAt) / 1000
  const cpuUsage = process.cpuUsage(cpuStart)

  return {
    cpuMicrosecondsPerOperation:
      (cpuUsage.user + cpuUsage.system) / config.throughputOperations,
    operationsPerSecond: config.throughputOperations / durationSeconds,
    setupMicrosecondsPerOperation:
      (setupMilliseconds * 1000) / config.throughputOperations,
    waitMicrosecondsPerOperation:
      (waitMilliseconds * 1000) / config.throughputOperations
  }
}

async function runWorker(): Promise<WorkerResult> {
  const kind = readClientKind()
  const config = readConfig()
  const deploymentUrl = readDeploymentUrl()
  const fetchAuthToken = createAuthTokenFetcher()
  const payload = 'x'.repeat(config.payloadBytes)

  collectGarbage()
  const processStart = memorySnapshot()
  const createClient = await loadClientFactory(kind)
  const counter = { value: Date.now() * 1000 + process.pid }
  const client = createClient(deploymentUrl, fetchAuthToken)
  let isClosed = false

  try {
    await warmUp(client, config, counter, payload)
    collectGarbage()
    const clientBaseline = memorySnapshot()
    let peakWorkload = clientBaseline
    // eslint-disable-next-line func-style -- This callback closes over the current peak sample.
    const sampleMemory = () => {
      peakWorkload = maximumMemory(peakWorkload, memorySnapshot())
    }
    const memoryTimer = setInterval(sampleMemory, 5)
    const operationResultList: OperationResult[] = []

    try {
      for (const operation of operationList) {
        // eslint-disable-next-line no-await-in-loop -- Operations run separately to avoid cross-workload interference.
        const latencyMeasurement = await measureLatency(
          client,
          operation,
          config,
          counter,
          payload
        )
        // eslint-disable-next-line no-await-in-loop -- Operations run separately to avoid cross-workload interference.
        const throughput = await measureThroughput(
          client,
          operation,
          config,
          counter,
          payload
        )
        sampleMemory()
        operationResultList.push({
          latency: latencyMeasurement.latency,
          operation,
          phaseTiming: {
            latencyFromServerMicrosecondsPerOperation:
              latencyMeasurement.fromServerMicrosecondsPerOperation,
            latencySetupMicrosecondsPerOperation:
              latencyMeasurement.setupMicrosecondsPerOperation,
            latencyToServerMicrosecondsPerOperation:
              latencyMeasurement.toServerMicrosecondsPerOperation,
            latencyWaitMicrosecondsPerOperation:
              latencyMeasurement.waitMicrosecondsPerOperation,
            throughputSetupMicrosecondsPerOperation:
              throughput.setupMicrosecondsPerOperation,
            throughputWaitMicrosecondsPerOperation:
              throughput.waitMicrosecondsPerOperation
          },
          throughputCpuMicrosecondsPerOperation:
            throughput.cpuMicrosecondsPerOperation,
          throughputOpsPerSecond: throughput.operationsPerSecond
        })
      }
    } finally {
      clearInterval(memoryTimer)
      sampleMemory()
    }

    await client.close()
    isClosed = true
    collectGarbage()
    const afterClose = memorySnapshot()

    return {
      client: kind,
      config,
      memory: {
        clientBaselineDelta: subtractMemory(clientBaseline, processStart),
        peakWorkloadDelta: subtractMemory(peakWorkload, clientBaseline),
        retainedAfterCloseDelta: subtractMemory(afterClose, processStart)
      },
      nodeVersion: process.version,
      operations: operationResultList
    }
  } finally {
    if (!isClosed) {
      await client.close()
    }
  }
}

try {
  const result = await runWorker()
  process.stdout.write(JSON.stringify(result))
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`
  )
  process.exitCode = 1
}

type IterationCounter = {
  value: number
}
