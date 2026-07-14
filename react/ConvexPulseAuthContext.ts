import { createContext, useContext } from 'react'

export const ConvexPulseAuthContext =
  createContext<ConvexPulseAuthState | null>(null)

/** Returns the backend-confirmed authentication state for the React client. */
export function useConvexPulseAuth(): ConvexPulseAuthState {
  const auth = useContext(ConvexPulseAuthContext)
  if (auth === null) {
    throw new Error('Convex Pulse auth must be used inside a provider')
  }
  return auth
}

/** @public */
export type ConvexPulseAuthState = Readonly<{
  isAuthenticated: boolean
  isLoading: boolean
  isRefreshing: boolean
}>
