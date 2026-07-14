<script lang="ts">
  import { mountConvexPulseDevtools } from 'convex-pulse/devtools'
  import { onMount } from 'svelte'

  import { client } from './client'
  import Home from './Home.svelte'
  import Task from './Task.svelte'
  import './App.css'

  let pathname = $state(window.location.pathname)

  function navigate(event: MouseEvent) {
    event.preventDefault()
    history.pushState({}, '', (event.currentTarget as HTMLAnchorElement).href)
    pathname = window.location.pathname
  }

  onMount(() => {
    const devtools = mountConvexPulseDevtools(client, { initialIsOpen: true })
    const updatePathname = () => (pathname = window.location.pathname)
    window.addEventListener('popstate', updatePathname)
    return () => {
      devtools.unmount()
      window.removeEventListener('popstate', updatePathname)
    }
  })
</script>

<div class="app-shell">
  {#if pathname === '/'}
    <Home {navigate} />
  {:else}
    <Task taskId={pathname.replace('/tasks/', '')} {navigate} />
  {/if}
</div>
