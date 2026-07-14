<script lang="ts">
  import { PUBLIC_CONVEX_URL } from '$env/static/public'
  import {
    ConvexPulseSvelteClient,
    createMutation,
    createPreloadedQuery
  } from 'convex-pulse/svelte'
  import type { PageProps } from './$types'

  import { api } from '#convex/api'

  const { data }: PageProps = $props()
  let hydrated = $state(false)
  const client = new ConvexPulseSvelteClient(PUBLIC_CONVEX_URL)
  const value = $derived(createPreloadedQuery(client, data.preloadedValue))
  const setValue = createMutation(client, api.fixture.setValue)

  $effect(() => {
    hydrated = true
    return () => void client.close()
  })
</script>

<main>
  {#if $value.status === 'error'}
    <p role="alert">{$value.error.message}</p>
  {:else}
    <p>Value: {String($value.data)}</p>
  {/if}
  <button
    type="button"
    onclick={() => void setValue({ key: 'preloaded', runId: data.runId, value: 'changed in SvelteKit' })}
  >Update value</button>
  <p>Hydrated: {hydrated ? 'yes' : 'no'}</p>
  <p>Mutation: {$setValue.status}</p>
</main>
