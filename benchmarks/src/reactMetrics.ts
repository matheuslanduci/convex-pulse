export function summarizeDuration(durationList: readonly number[]) {
  if (durationList.length === 0) {
    throw new Error('Expected at least one duration')
  }
  const sortedDurationList = durationList.toSorted(
    (left, right) => left - right
  )

  return {
    meanMs:
      durationList.reduce((total, duration) => total + duration, 0) /
      durationList.length,
    p50Ms: percentile(sortedDurationList, 50),
    p95Ms: percentile(sortedDurationList, 95)
  }
}

function percentile(sortedValueList: readonly number[], value: number) {
  const index = Math.max(
    0,
    Math.ceil((value / 100) * sortedValueList.length) - 1
  )

  return sortedValueList[index] as number
}

export type DurationSummary = Readonly<{
  meanMs: number
  p50Ms: number
  p95Ms: number
}>
