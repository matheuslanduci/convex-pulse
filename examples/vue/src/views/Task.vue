<script setup lang="ts">
import { useMutation, useQuery } from 'convex-pulse/vue'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { api } from '#convex/api'
import type { Id } from '#convex/dataModel'

const route = useRoute()
const taskId = computed(() => route.params.taskId as Id<'task'>)
const task = useQuery(api.tasks.get, { args: { id: taskId.value } })
const setDone = useMutation(api.tasks.setDone, {
  optimistic: ({ data, store }) =>
    store.get(api.tasks.get, { id: data.id }).merge({ done: data.done })
})
</script>

<template>
  <main>
    <RouterLink class="back-link" to="/">← All tasks</RouterLink>
    <article class="detail-card">
      <p class="eyebrow">Individual query</p>
      <p v-if="task.status === 'pending'" class="state">Loading task…</p>
      <p v-else-if="task.status === 'error'" class="state error" role="alert">
        {{ task.error.message }}
      </p>
      <template v-else
        ><h1>{{ task.data.title }}</h1>
        <label class="completion-control"
          ><input
            :checked="task.data.done ?? false"
            type="checkbox"
            @change="
              setDone({
                done: ($event.target as HTMLInputElement).checked,
                id: task.data._id
              })
            "
          /><span
            ><strong>{{ task.data.done ? 'Completed' : 'Open' }}</strong
            ><small>Synced live through Convex</small></span
          ></label
        >
        <dl>
          <div>
            <dt>Document ID</dt>
            <dd>{{ task.data._id }}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{{ new Date(task.data._creationTime).toLocaleString() }}</dd>
          </div>
        </dl></template
      >
    </article>
  </main>
</template>
