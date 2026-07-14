import { convexLoad, convexLoadPaginated } from 'convex-pulse/sveltekit'
import { makeFunctionReference } from 'convex/server'

import { api } from '#convex/api'

export async function load() {
  return {
    labels: await convexLoadPaginated(
      makeFunctionReference<'query'>('fixture:paginateLabels'),
      { prefix: 'ssr-label' },
      { initialNumItems: 2 }
    ),
    skipped: await convexLoad(api.tasks.list, 'skip'),
    tasks: await convexLoad(api.tasks.list, {})
  }
}
