import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { cpus, release } from 'node:os'
import path from 'node:path'
import process from 'node:process'

import type {
  BenchmarkClientKind,
  BenchmarkOperation,
  MemorySnapshot,
  OperationResult,
  WorkerResult
} from '#benchmark/types.js'

const packageDirectory = path.resolve(import.meta.dirname, '..')
const workerPath = path.resolve(import.meta.dirname, 'worker.ts')
const clientKindList: readonly BenchmarkClientKind[] = [
  'convex-js',
  'convex-pulse'
]
const operationList: readonly BenchmarkOperation[] = [
  'query',
  'mutation',
  'action'
]
const benchmarkEnvironment = {
  cpu: cpus()[0]?.model ?? 'Unknown CPU',
  nodeVersion: process.version,
  operatingSystem: `${process.platform} ${release()} ${process.arch}`
}

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

function runWorker(kind: BenchmarkClientKind): WorkerResult {
  const result = spawnSync(
    process.execPath,
    ['--expose-gc', '--experimental-strip-types', workerPath, kind],
    {
      cwd: packageDirectory,
      encoding: 'utf-8',
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1'
      }
    }
  )

  if (result.error !== undefined) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(
      `${kind} benchmark failed:\n${result.stderr || result.stdout}`
    )
  }

  const parsed = JSON.parse(result.stdout) as WorkerResult
  if (parsed.client !== kind) {
    throw new Error(`${kind} worker returned an invalid result`)
  }
  return parsed
}

function median(valueList: readonly number[]) {
  const sortedValueList = valueList.toSorted((left, right) => left - right)
  const middle = Math.floor(sortedValueList.length / 2)
  if (sortedValueList.length % 2 === 1) {
    return sortedValueList[middle] as number
  }
  return (
    ((sortedValueList[middle - 1] as number) +
      (sortedValueList[middle] as number)) /
    2
  )
}

function resultFor(
  sample: WorkerResult,
  operation: BenchmarkOperation
): OperationResult {
  const result = sample.operations.find(
    (candidate) => candidate.operation === operation
  )
  if (result === undefined) {
    throw new Error(`${sample.client} did not report ${operation}`)
  }
  return result
}

function samplesFor(
  sampleList: readonly WorkerResult[],
  kind: BenchmarkClientKind
) {
  return sampleList.filter((sample) => sample.client === kind)
}

function formatMetric(value: number) {
  return value.toFixed(2)
}

function formatMebibytes(value: number) {
  return (value / 1024 / 1024).toFixed(2)
}

function renderTable(
  headerList: readonly string[],
  rowList: readonly (readonly string[])[]
) {
  const allRowList = [headerList, ...rowList]
  const widthList = headerList.map((_header, index) =>
    Math.max(...allRowList.map((row) => (row[index] ?? '').length))
  )

  function renderRow(row: readonly string[]) {
    return `| ${row
      .map((value, index) => value.padEnd(widthList[index] as number))
      .join(' | ')} |`
  }

  const separator = `|-${widthList.map((width) => '-'.repeat(width)).join('-|-')}-|`
  return [renderRow(headerList), separator, ...rowList.map(renderRow)].join(
    '\n'
  )
}

function operationRows(sampleList: readonly WorkerResult[]) {
  const rowList: string[][] = []
  for (const kind of clientKindList) {
    const clientSampleList = samplesFor(sampleList, kind)
    for (const operation of operationList) {
      const resultList = clientSampleList.map((sample) =>
        resultFor(sample, operation)
      )
      rowList.push([
        kind,
        operation,
        formatMetric(median(resultList.map((result) => result.latency.meanMs))),
        formatMetric(median(resultList.map((result) => result.latency.p50Ms))),
        formatMetric(median(resultList.map((result) => result.latency.p95Ms))),
        formatMetric(median(resultList.map((result) => result.latency.p99Ms))),
        formatMetric(
          median(
            resultList.map(
              (result) => result.latency.cpuMicrosecondsPerOperation
            )
          )
        ),
        formatMetric(
          median(resultList.map((result) => result.throughputOpsPerSecond))
        ),
        formatMetric(
          median(
            resultList.map(
              (result) => result.throughputCpuMicrosecondsPerOperation
            )
          )
        )
      ])
    }
  }
  return rowList
}

function medianMemory(
  sampleList: readonly WorkerResult[],
  select: (sample: WorkerResult) => MemorySnapshot
): MemorySnapshot {
  return {
    heapUsedBytes: median(
      sampleList.map((sample) => select(sample).heapUsedBytes)
    ),
    rssBytes: median(sampleList.map((sample) => select(sample).rssBytes))
  }
}

function memoryRows(sampleList: readonly WorkerResult[]) {
  return clientKindList.map((kind) => {
    const clientSampleList = samplesFor(sampleList, kind)
    const baseline = medianMemory(
      clientSampleList,
      (sample) => sample.memory.clientBaselineDelta
    )
    const peak = medianMemory(
      clientSampleList,
      (sample) => sample.memory.peakWorkloadDelta
    )
    const retained = medianMemory(
      clientSampleList,
      (sample) => sample.memory.retainedAfterCloseDelta
    )

    return [
      kind,
      formatMebibytes(baseline.rssBytes),
      formatMebibytes(peak.rssBytes),
      formatMebibytes(retained.rssBytes),
      formatMebibytes(baseline.heapUsedBytes),
      formatMebibytes(peak.heapUsedBytes),
      formatMebibytes(retained.heapUsedBytes)
    ]
  })
}

function phaseTimingRows(sampleList: readonly WorkerResult[]) {
  const rowList: string[][] = []
  for (const kind of clientKindList) {
    const clientSampleList = samplesFor(sampleList, kind)
    for (const operation of operationList) {
      const resultList = clientSampleList.map((sample) =>
        resultFor(sample, operation)
      )
      rowList.push([
        kind,
        operation,
        formatMetric(
          median(
            resultList.map(
              (result) =>
                result.phaseTiming.latencySetupMicrosecondsPerOperation
            )
          )
        ),
        formatMetric(
          median(
            resultList.map(
              (result) =>
                result.phaseTiming.latencyToServerMicrosecondsPerOperation
            )
          )
        ),
        formatMetric(
          median(
            resultList.map(
              (result) =>
                result.phaseTiming.latencyFromServerMicrosecondsPerOperation
            )
          )
        ),
        formatMetric(
          median(
            resultList.map(
              (result) => result.phaseTiming.latencyWaitMicrosecondsPerOperation
            )
          )
        ),
        formatMetric(
          median(
            resultList.map(
              (result) =>
                result.phaseTiming.throughputSetupMicrosecondsPerOperation
            )
          )
        ),
        formatMetric(
          median(
            resultList.map(
              (result) =>
                result.phaseTiming.throughputWaitMicrosecondsPerOperation
            )
          )
        )
      ])
    }
  }
  return rowList
}

function writeResults(sampleList: readonly WorkerResult[]) {
  const configuredPath = process.env.BENCHMARK_OUTPUT
  if (configuredPath === undefined) {
    return
  }
  const outputPath = path.resolve(packageDirectory, configuredPath)

  mkdirSync(path.dirname(outputPath), { recursive: true })
  writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        environment: benchmarkEnvironment,
        generatedAt: new Date().toISOString(),
        samples: sampleList
      },
      null,
      2
    )}\n`
  )
  process.stdout.write(`\nRaw results: ${outputPath}\n`)
}

function main() {
  const runCount = readPositiveInteger('BENCHMARK_RUNS', 4)
  const sampleList: WorkerResult[] = []

  for (let run = 0; run < runCount; run += 1) {
    const orderedClientList =
      run % 2 === 0 ? clientKindList : clientKindList.toReversed()
    for (const kind of orderedClientList) {
      process.stderr.write(`Run ${run + 1}/${runCount}: ${kind}\n`)
      sampleList.push(runWorker(kind))
    }
  }

  const config = sampleList[0]?.config
  if (config === undefined) {
    throw new Error('No benchmark samples were produced')
  }

  process.stdout.write(
    `\n${benchmarkEnvironment.nodeVersion} · ${benchmarkEnvironment.operatingSystem} · ` +
      `${benchmarkEnvironment.cpu}\n` +
      `${runCount} run(s) · ` +
      `${config.latencyIterations} latency ops · ` +
      `${config.throughputOperations} throughput ops @ concurrency ${config.concurrency}\n\n`
  )
  process.stdout.write('Latency and throughput (median across runs)\n\n')
  process.stdout.write(
    `${renderTable(
      [
        'Client',
        'Operation',
        'Mean ms',
        'p50 ms',
        'p95 ms',
        'p99 ms',
        'Latency CPU µs/op',
        'ops/s',
        'Throughput CPU µs/op'
      ],
      operationRows(sampleList)
    )}\n\n`
  )
  process.stdout.write('Memory deltas (MiB, median across runs)\n\n')
  process.stdout.write(
    `${renderTable(
      [
        'Client',
        'Base RSS',
        'Peak RSS',
        'Retained RSS',
        'Base heap',
        'Peak heap',
        'Retained heap'
      ],
      memoryRows(sampleList)
    )}\n`
  )
  process.stdout.write('\nClient phase timing (µs/op, median across runs)\n\n')
  process.stdout.write(
    `${renderTable(
      [
        'Client',
        'Operation',
        'Latency setup',
        'To server',
        'From server',
        'Latency wait',
        'Throughput setup',
        'Throughput wait'
      ],
      phaseTimingRows(sampleList)
    )}\n`
  )
  writeResults(sampleList)
}

try {
  main()
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`
  )
  process.exitCode = 1
}
