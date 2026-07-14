import { SyncClient } from '#client/SyncClient.js'
import { FakeTransport } from '#testkit/FakeTransport.js'

const sampleCount = 10
const workloadSize = 2000

function benchmarkTransitionApply() {
  const durationList: number[] = []
  console.time('transition apply total')
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const transport = new FakeTransport()
    const client = new SyncClient(transport)
    transport.connect()
    for (let queryId = 0; queryId < workloadSize; queryId += 1) {
      client.subscribe(
        {
          args: { queryId },
          key: `benchmark:${queryId}`,
          path: 'benchmark:value'
        },
        noop
      )
    }
    const startedAt = performance.now()
    transport.receive({
      endVersion: { identity: 0, querySet: workloadSize, ts: 1n },
      modifications: Array.from({ length: workloadSize }, (_, queryId) => ({
        journal: `journal:${queryId}`,
        queryId,
        type: 'QueryUpdated' as const,
        value: queryId
      })),
      startVersion: { identity: 0, querySet: 0, ts: 0n },
      type: 'Transition'
    })
    durationList.push(performance.now() - startedAt)
    void client.close()
  }
  console.timeEnd('transition apply total')
  report('transition apply', durationList)
}

function benchmarkMutationReflection() {
  const durationList: number[] = []
  console.time('mutation reflection total')
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const transport = new FakeTransport()
    const client = new SyncClient(transport)
    transport.connect()
    for (let requestId = 0; requestId < workloadSize; requestId += 1) {
      void client.mutation({ args: { requestId }, path: 'benchmark:mutate' })
    }
    const startedAt = performance.now()
    for (let requestId = 0; requestId < workloadSize; requestId += 1) {
      transport.receive({
        requestId,
        result: requestId,
        success: true,
        ts: BigInt(requestId + 1),
        type: 'MutationResponse'
      })
    }
    transport.receive({
      endVersion: { identity: 0, querySet: 0, ts: BigInt(workloadSize) },
      modifications: [],
      startVersion: { identity: 0, querySet: 0, ts: 0n },
      type: 'Transition'
    })
    durationList.push(performance.now() - startedAt)
    void client.close()
  }
  console.timeEnd('mutation reflection total')
  report('mutation reflection', durationList)
}

function report(label: string, durationList: readonly number[]) {
  const sortedDurationList = durationList.toSorted(
    (left, right) => left - right
  )
  process.stdout.write(
    `${label}: p50=${percentile(sortedDurationList, 0.5).toFixed(2)}ms p95=${percentile(sortedDurationList, 0.95).toFixed(2)}ms\n`
  )
}

function percentile(valueList: readonly number[], fraction: number) {
  return valueList[Math.ceil(valueList.length * fraction) - 1] ?? 0
}

function noop() {
  void 0
}

benchmarkTransitionApply()
benchmarkMutationReflection()
