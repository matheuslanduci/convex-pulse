<script lang="ts">
  import { useMutation } from 'convex-pulse/svelte'
  import type { PageProps } from './$types'

  import { api } from '#convex/api'

  let { data }: PageProps = $props()
  let title = $state('')
  let hydrated = $state(false)
  const tasks = $derived(data.tasks)
  const labels = $derived(data.labels)
  const createTask = useMutation(api.tasks.create)
  const removeTask = useMutation(api.tasks.remove)

  $effect(() => {
    hydrated = true
  })

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (trimmedTitle.length === 0) return

    void createTask({ title: trimmedTitle })
    title = ''
  }
</script>

<main>
  <h1>Convex Pulse · SvelteKit</h1>
  <p>Hydrated: {hydrated ? 'yes' : 'no'}</p>
  <p>Skipped: {data.skipped.status}</p>
  <p>Labels: {labels.data?.join(', ')}</p>
  {#if labels.canLoadMore}
    <button type="button" onclick={() => labels.loadMore(3)}>Load more labels</button>
  {/if}
  <form onsubmit={handleSubmit}>
    <input aria-label="Task title" placeholder="What needs doing?" bind:value={title} />
    <button type="submit">Add task</button>
  </form>
  {#if $createTask.status === 'error'}
    <p role="alert">{$createTask.error.message}</p>
  {/if}
  {#if tasks.status === 'pending'}
    <p>Loading…</p>
  {:else if tasks.status === 'error'}
    <p role="alert">{tasks.error.message}</p>
  {:else if tasks.data?.length === 0}
    <p>No tasks yet.</p>
  {:else}
    <ul>
      {#each tasks.data ?? [] as task (task._id)}
        <li>
          {task.title}
          <button type="button" onclick={() => void removeTask({ id: task._id })}>
            Delete {task.title}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</main>
