<script lang="ts">
  import { env } from '$env/dynamic/public'
  import { setupConvex } from 'convex-pulse/svelte'

  let { children } = $props()
  setupConvex(requiredEnvironmentVariable(env.PUBLIC_CONVEX_URL))

  function requiredEnvironmentVariable(value: string | undefined) {
    if (value === undefined) {
      throw new Error('PUBLIC_CONVEX_URL is not set')
    }
    return value
  }
</script>

{@render children()}
