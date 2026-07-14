import { preloadQuery } from 'convex-pulse/nextjs'

import { Tasks } from '#app/tasks'
import { api } from '#convex/api'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const preloadedTasks = await preloadQuery(api.tasks.list, { args: {} })

  return (
    <main>
      <h1>Convex Pulse · Next.js</h1>
      <Tasks preloadedTasks={preloadedTasks} />
    </main>
  )
}
