<script setup lang="ts">
import { useMutation, usePrefetchQuery, useQuery } from 'convex-pulse/vue'
import { ref } from 'vue'

import { api } from '#convex/api'
import type { Id } from '#convex/dataModel'

const title = ref('')
const taskList = useQuery(api.tasks.list, { args: {} })
const prefetchTask = usePrefetchQuery(api.tasks.get)
const createTask = useMutation(api.tasks.create, {
  optimistic: ({ store, data, optimisticId }) =>
    store.get(api.tasks.list).append({
      _id: optimisticId,
      _creationTime: Date.now(),
      done: false,
      ...data
    })
})

function handleSubmit() {
  const trimmedTitle = title.value.trim()
  if (!trimmedTitle) return
  void createTask({ title: trimmedTitle })
  title.value = ''
}

function prefetch(id: Id<'task'>) {
  void prefetchTask({ id }).ready.catch(() => undefined)
}
</script>

<template>
  <main>
    <header class="hero">
      <p class="eyebrow">Convex Pulse · Vue</p>
      <h1>Small tasks, visible state.</h1>
      <p class="lede">
        Hover a task to prefetch it, open it to subscribe, then come back to
        watch the inactive query age in the inspector.
      </p>
    </header>
    <section class="task-card" aria-labelledby="tasks-heading">
      <div class="section-heading">
        <div>
          <p class="section-kicker">Cloud data</p>
          <h2 id="tasks-heading">Tasks</h2>
        </div>
        <span v-if="taskList.status === 'success'" class="task-count">{{
          taskList.data.length
        }}</span>
      </div>
      <form @submit.prevent="handleSubmit">
        <input
          v-model="title"
          aria-label="Task title"
          placeholder="What needs doing?"
        /><button type="submit">Add task</button>
      </form>
      <p v-if="taskList.status === 'pending'" class="state">Loading…</p>
      <p
        v-else-if="taskList.status === 'error'"
        class="state error"
        role="alert"
      >
        {{ taskList.error.message }}
      </p>
      <p v-else-if="taskList.data.length === 0" class="state">
        No tasks yet. Add the first one.
      </p>
      <ul v-else class="task-list">
        <li v-for="task in taskList.data" :key="task._id">
          <RouterLink
            :to="`/tasks/${task._id}`"
            @focus="prefetch(task._id)"
            @mouseenter="prefetch(task._id)"
            ><span :class="{ done: task.done }">{{ task.title }}</span
            ><span aria-hidden="true">↗</span></RouterLink
          >
        </li>
      </ul>
    </section>
  </main>
</template>
