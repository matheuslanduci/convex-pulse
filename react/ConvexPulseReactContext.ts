import { createContext, useContext } from 'react'

import type { ConvexPulseReactClient } from '#react/ConvexPulseReactClient.js'

export const ConvexPulseReactContext =
  createContext<ConvexPulseReactClient | null>(null)

export function useConvexPulseReactClient() {
  const client = useContext(ConvexPulseReactContext)
  if (client === null) {
    throw new Error('Convex Pulse hooks must be used inside a provider')
  }
  return client
}
