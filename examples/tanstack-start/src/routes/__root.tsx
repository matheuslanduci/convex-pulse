import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts
} from '@tanstack/react-router'
import { ConvexPulseReactProvider } from 'convex-pulse/react'

import { convex } from '#src/convex'

export const Route = createRootRoute({
  component: RootComponent,
  head: () => ({ meta: [{ title: 'Convex Pulse · TanStack Start' }] })
})

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <ConvexPulseReactProvider convex={convex}>
          <Outlet />
        </ConvexPulseReactProvider>
        <Scripts />
      </body>
    </html>
  )
}
