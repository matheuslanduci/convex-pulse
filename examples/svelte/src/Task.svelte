<script lang="ts">
  import { createMutation, createQuery } from 'convex-pulse/svelte'
  import { untrack } from 'svelte'

  import { api } from '#convex/api'
  import type { Id } from '#convex/dataModel'
  import { client } from './client'

  const { navigate, taskId }: Props = $props()
  const initialTaskId = untrack(() => taskId)
  const task = createQuery(client, api.tasks.get, { args: { id: initialTaskId as Id<'task'> } })
  const setDone = createMutation(client, api.tasks.setDone, {
    optimistic: ({ data, store }) => store.get(api.tasks.get, { id: data.id }).merge({ done: data.done })
  })

  type Props = { navigate: (event: MouseEvent) => void; taskId: string }
</script>

<main><a class="back-link" href="/" onclick={navigate}>← All tasks</a><article class="detail-card"><p class="eyebrow">Individual query</p>{#if $task.status === 'pending'}<p class="state">Loading task…</p>{:else if $task.status === 'error'}<p class="state error" role="alert">{$task.error.message}</p>{:else}<h1>{$task.data.title}</h1><label class="completion-control"><input checked={$task.data.done ?? false} type="checkbox" onchange={(event) => void setDone({ done: event.currentTarget.checked, id: $task.data._id })} /><span><strong>{$task.data.done ? 'Completed' : 'Open'}</strong><small>Synced live through Convex</small></span></label><dl><div><dt>Document ID</dt><dd>{$task.data._id}</dd></div><div><dt>Created</dt><dd>{new Date($task.data._creationTime).toLocaleString()}</dd></div></dl>{/if}</article></main>
