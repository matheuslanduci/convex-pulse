import { ConvexPulseSvelteClient } from 'convex-pulse/svelte'

export const client = new ConvexPulseSvelteClient(
  import.meta.env.VITE_CONVEX_URL,
  { gcTime: 60_000 }
)
