import { ConvexPulseReactClient } from 'convex-pulse/react'

export const convex = new ConvexPulseReactClient(
  requiredEnvironmentVariable(import.meta.env.VITE_CONVEX_URL)
)

function requiredEnvironmentVariable(value: string | undefined) {
  if (value === undefined) {
    throw new Error('VITE_CONVEX_URL is not set')
  }
  return value
}
