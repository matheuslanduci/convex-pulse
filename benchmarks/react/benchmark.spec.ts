import { expect, test } from '@playwright/test'

import { summarizeDuration } from '#benchmark/reactMetrics.js'
import type { DurationSummary } from '#benchmark/reactMetrics.js'

const clientKindList = ['convex-js', 'convex-pulse'] as const

/* eslint-disable no-await-in-loop -- Browser benchmark samples must run serially to avoid workload interference. */
test('benchmarks convex-js and convex-pulse React query and mutation rendering', async ({
  page
}) => {
  const iterationCount = readPositiveInteger('BENCHMARK_REACT_ITERATIONS', 20)
  const warmupCount = readPositiveInteger('BENCHMARK_REACT_WARMUPS', 5)
  const payload = 'x'.repeat(
    readPositiveInteger('BENCHMARK_PAYLOAD_BYTES', 128)
  )
  const resultList: ReactBenchmarkResult[] = []

  for (const client of clientKindList) {
    const queryDurationList: number[] = []
    const mutationDurationList: number[] = []

    for (
      let iteration = 0;
      iteration < warmupCount + iterationCount;
      iteration += 1
    ) {
      const input = Date.now() * 1000 + iteration

      await page.goto(
        `/?client=${client}&iteration=${input}&payload=${encodeURIComponent(payload)}`
      )
      await expect(page.getByTestId('query-result')).toHaveText(String(input))
      await page.getByRole('button', { name: 'Run mutation' }).click()
      await expect(page.getByTestId('mutation-result')).toHaveText(
        String(input + 1)
      )
      const duration = await page.evaluate(() => ({
        mutation: window.__benchmarkMutationDurationMs,
        query: window.__benchmarkQueryDurationMs
      }))

      expect(duration.query).toBeGreaterThan(0)
      expect(duration.mutation).toBeGreaterThan(0)
      if (iteration >= warmupCount) {
        queryDurationList.push(duration.query as number)
        mutationDurationList.push(duration.mutation as number)
      }
    }
    resultList.push({
      client,
      mutation: summarizeDuration(mutationDurationList),
      query: summarizeDuration(queryDurationList)
    })
  }

  process.stdout.write(`\n${renderResults(resultList)}\n`)
})
/* eslint-enable no-await-in-loop */

function readPositiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback)

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }

  return value
}

function renderResults(resultList: readonly ReactBenchmarkResult[]) {
  const lineList = [
    'React render latency (browser ms)',
    'Client       Operation  Mean    p50     p95'
  ]

  for (const result of resultList) {
    for (const operation of ['query', 'mutation'] as const) {
      const summary = result[operation]

      lineList.push(
        `${result.client.padEnd(12)} ${operation.padEnd(9)} ${format(summary.meanMs)} ${format(summary.p50Ms)} ${format(summary.p95Ms)}`
      )
    }
  }

  return lineList.join('\n')
}

function format(value: number) {
  return value.toFixed(2).padStart(7)
}

type ReactBenchmarkResult = Readonly<{
  client: (typeof clientKindList)[number]
  mutation: DurationSummary
  query: DurationSummary
}>
