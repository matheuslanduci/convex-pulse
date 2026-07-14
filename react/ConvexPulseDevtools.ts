import { useEffect } from 'react'
import type { ReactNode } from 'react'

import { mountConvexPulseDevtools } from '#devtools/ConvexPulseDevtools.js'
import type { MountConvexPulseDevtoolsOptions } from '#devtools/ConvexPulseDevtools.js'
import { useConvexPulseReactClient } from '#react/ConvexPulseReactContext.js'

/** Mounts the Convex Pulse client inspector for the nearest React provider. */
export function ConvexPulseDevtools(
  props: ConvexPulseDevtoolsProps
): ReactNode {
  const client = useConvexPulseReactClient()
  const { container, initialIsOpen, position, styleNonce } = props

  useEffect(() => {
    const devtools = mountConvexPulseDevtools(client, {
      ...(container === undefined ? {} : { container }),
      ...(initialIsOpen === undefined ? {} : { initialIsOpen }),
      ...(position === undefined ? {} : { position }),
      ...(styleNonce === undefined ? {} : { styleNonce })
    })
    return () => devtools.unmount()
  }, [client, container, initialIsOpen, position, styleNonce])

  return null
}

/** @public */
export type ConvexPulseDevtoolsProps = MountConvexPulseDevtoolsOptions
