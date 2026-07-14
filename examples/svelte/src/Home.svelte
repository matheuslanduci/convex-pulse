<script lang="ts">
  import { createMutation, createPrefetchQuery, createQuery } from 'convex-pulse/svelte'
  import { api } from '#convex/api'
  import type { Id } from '#convex/dataModel'
  import { client } from './client'

  const { navigate }: Props = $props()
  let title = $state('')
  const taskList = createQuery(client, api.tasks.list, { args: {} })
  const prefetchTask = createPrefetchQuery(client, api.tasks.get)
  const createTask = createMutation(client, api.tasks.create, {
    optimistic: ({ store, data, optimisticId }) => store.get(api.tasks.list).append({ _id: optimisticId, _creationTime: Date.now(), done: false, ...data })
  })

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return
    void createTask({ title: trimmedTitle })
    title = ''
  }

  function prefetch(id: Id<'task'>) {
    void prefetchTask({ id }).ready.catch(() => undefined)
  }

  type Props = { navigate: (event: MouseEvent) => void }
</script>

<main>
  <header class="hero"><p class="eyebrow">Convex Pulse · Svelte</p><h1>Small tasks, visible state.</h1><p class="lede">Hover a task to prefetch it, open it to subscribe, then come back to watch the inactive query age in the inspector.</p></header>
  <section class="task-card" aria-labelledby="tasks-heading">
    <div class="section-heading"><div><p class="section-kicker">Cloud data</p><h2 id="tasks-heading">Tasks</h2></div>{#if $taskList.status === 'success'}<span class="task-count">{$taskList.data.length}</span>{/if}</div>
    <form onsubmit={handleSubmit}><input aria-label="Task title" placeholder="What needs doing?" bind:value={title} /><button type="submit">Add task</button></form>
    {#if $taskList.status === 'pending'}<p class="state">Loading…</p>{:else if $taskList.status === 'error'}<p class="state error" role="alert">{$taskList.error.message}</p>{:else if $taskList.data.length === 0}<p class="state">No tasks yet. Add the first one.</p>{:else}<ul class="task-list">{#each $taskList.data as task (task._id)}<li><a href={`/tasks/${task._id}`} onclick={navigate} onfocus={() => prefetch(task._id)} onmouseenter={() => prefetch(task._id)}><span class:done={task.done}>{task.title}</span><span aria-hidden="true">↗</span></a></li>{/each}</ul>{/if}
  </section>
</main>
