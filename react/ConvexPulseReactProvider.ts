import type { ReactNode } from 'react'
import { createElement, useEffect, useRef, useState } from 'react'

import { ConvexPulseAuthContext } from '#react/ConvexPulseAuthContext.js'
import type {
  AuthTokenFetcher,
  ConvexPulseReactClient
} from '#react/ConvexPulseReactClient.js'
import { ConvexPulseReactContext } from '#react/ConvexPulseReactContext.js'

/** Makes a React client available to descendant React hooks. */
export function ConvexPulseReactProvider(
  props: ConvexPulseReactProviderProps
): ReactNode {
  const authConfigured = props.fetchToken !== undefined
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(() =>
    authConfigured || props.isAuthLoading === true ? null : false
  )
  const [isRefreshing, setIsRefreshing] = useState(false)
  const previousAuth = useRef({
    convex: props.convex,
    fetchToken: props.fetchToken,
    isAuthLoading: props.isAuthLoading
  })
  const authChanged =
    previousAuth.current.convex !== props.convex ||
    previousAuth.current.fetchToken !== props.fetchToken ||
    previousAuth.current.isAuthLoading !== props.isAuthLoading

  if (authChanged) {
    previousAuth.current = {
      convex: props.convex,
      fetchToken: props.fetchToken,
      isAuthLoading: props.isAuthLoading
    }
    const nextIsAuthenticated =
      authConfigured || props.isAuthLoading === true ? null : false
    if (isAuthenticated !== nextIsAuthenticated) {
      setIsAuthenticated(nextIsAuthenticated)
    }
    if (isRefreshing) {
      setIsRefreshing(false)
    }
  }

  const isLoading = isAuthenticated === null
  const authState = {
    isAuthenticated: isAuthenticated ?? false,
    isLoading,
    isRefreshing: isRefreshing && isAuthenticated === true
  }

  return createElement(
    ConvexPulseAuthContext.Provider,
    { value: authState },
    createElement(AuthFirstEffect, {
      convex: props.convex,
      fetchToken: props.fetchToken,
      isAuthLoading: props.isAuthLoading,
      setIsAuthenticated,
      setIsRefreshing
    }),
    createElement(
      ConvexPulseReactContext.Provider,
      { value: props.convex },
      isLoading ? (props.authLoadingFallback ?? null) : props.children
    ),
    createElement(AuthLastEffect, {
      convex: props.convex,
      fetchToken: props.fetchToken,
      isAuthLoading: props.isAuthLoading,
      setIsAuthenticated,
      setIsRefreshing
    })
  )
}

function AuthFirstEffect(props: AuthEffectProps) {
  useEffect(() => {
    if (props.isAuthLoading === true || props.fetchToken === undefined) {
      return
    }
    let active = true
    props.convex.setAuth(props.fetchToken, {
      onChange: (isAuthenticated) => {
        if (active) {
          props.setIsAuthenticated(isAuthenticated)
        }
      },
      onRefreshChange: (isRefreshing) => {
        if (active) {
          props.setIsRefreshing(isRefreshing)
        }
      }
    })

    return () => {
      active = false
      props.setIsAuthenticated((current) => (current ? false : null))
      props.setIsRefreshing(false)
    }
  }, [props.convex, props.fetchToken, props.isAuthLoading])

  return null
}

function AuthLastEffect(props: AuthEffectProps) {
  useEffect(() => {
    if (props.isAuthLoading === true || props.fetchToken === undefined) {
      return
    }

    return () => {
      props.convex.clearAuth()
      props.setIsAuthenticated(null)
      props.setIsRefreshing(false)
    }
  }, [props.convex, props.fetchToken, props.isAuthLoading])

  return null
}

/** @public */
export type ConvexPulseReactProviderProps = Readonly<{
  authLoadingFallback?: ReactNode
  children?: ReactNode
  convex: ConvexPulseReactClient
  fetchToken?: AuthTokenFetcher
  isAuthLoading?: boolean
}>

type AuthEffectProps = Readonly<{
  convex: ConvexPulseReactClient
  fetchToken: AuthTokenFetcher | undefined
  isAuthLoading: boolean | undefined
  setIsAuthenticated: React.Dispatch<React.SetStateAction<boolean | null>>
  setIsRefreshing: React.Dispatch<React.SetStateAction<boolean>>
}>
