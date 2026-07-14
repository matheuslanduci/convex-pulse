'use client'

import {
  ConvexPulseReactClient,
  ConvexPulseReactProvider
} from 'convex-pulse/react'
import type { ReactNode } from 'react'

const client = new ConvexPulseReactClient(
  requiredEnvironmentVariable(process.env.NEXT_PUBLIC_CONVEX_URL)
)

export function ConvexClientProvider({ children }: ConvexClientProviderProps) {
  return (
    <ConvexPulseReactProvider convex={client}>
      {children}
    </ConvexPulseReactProvider>
  )
}

function requiredEnvironmentVariable(value: string | undefined) {
  if (value === undefined) {
    throw new Error('NEXT_PUBLIC_CONVEX_URL is not set')
  }
  return value
}

type ConvexClientProviderProps = Readonly<{ children: ReactNode }>
