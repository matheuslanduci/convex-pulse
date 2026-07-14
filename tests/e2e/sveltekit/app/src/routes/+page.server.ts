import { randomUUID } from 'node:crypto'

import { env } from '$env/dynamic/public'
import { ConvexPulseHttpClient } from 'convex-pulse/http'

import { api } from '#convex/api'

export async function load() {
  const runId = randomUUID()
  const client = new ConvexPulseHttpClient(
    requiredEnvironmentVariable(env.PUBLIC_CONVEX_URL)
  )
  return {
    preloadedValue: await client.preloadQuery(api.fixture.getValue, {
      args: { key: 'preloaded', runId }
    }),
    runId
  }
}

function requiredEnvironmentVariable(value: string | undefined) {
  if (value === undefined) {
    throw new Error('PUBLIC_CONVEX_URL is not set')
  }
  return value
}
