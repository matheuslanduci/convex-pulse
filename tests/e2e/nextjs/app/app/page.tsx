import { randomUUID } from 'node:crypto'

import { preloadQuery } from 'convex-pulse/nextjs'

import { api } from '#convex/api'

import { LiveValue } from './value'

export default async function Page() {
  const runId = randomUUID()
  const preloadedValue = await preloadQuery(api.fixture.getValue, {
    args: { key: 'preloaded', runId }
  })

  return <LiveValue preloadedValue={preloadedValue} runId={runId} />
}
