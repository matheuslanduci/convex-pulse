import { A, Route, Router, useParams } from '@solidjs/router'
import { mountConvexPulseDevtools } from 'convex-pulse/devtools'
import {
  ConvexPulseSolidClient,
  createMutation,
  createPrefetchQuery,
  createQuery
} from 'convex-pulse/solid'
import { createSignal, For, onMount, Show } from 'solid-js'

import { api } from '#convex/api'
import type { Id } from '#convex/dataModel'

import './App.css'

const client = new ConvexPulseSolidClient(import.meta.env.VITE_CONVEX_URL, {
  gcTime: 60_000
})

export default function App() {
  onMount(() => {
    const devtools = mountConvexPulseDevtools(client, { initialIsOpen: true })
    return () => devtools.unmount()
  })

  return (
    <Router root={(props) => <div class="app-shell">{props.children}</div>}>
      <Route path="/" component={Home} />
      <Route path="/tasks/:taskId" component={Task} />
    </Router>
  )
}

function Home() {
  const [title, setTitle] = createSignal('')
  const taskList = createQuery(client, api.tasks.list, { args: {} })
  const prefetchTask = createPrefetchQuery(client, api.tasks.get)
  const createTask = createMutation(client, api.tasks.create, {
    optimistic: ({ store, data, optimisticId }) =>
      store.get(api.tasks.list).append({
        _id: optimisticId,
        _creationTime: Date.now(),
        done: false,
        ...data
      })
  })

  function handleSubmit(event: SubmitEvent) {
    event.preventDefault()
    const trimmedTitle = title().trim()
    if (!trimmedTitle) return
    void createTask({ title: trimmedTitle })
    setTitle('')
  }

  function prefetch(id: Id<'task'>) {
    void prefetchTask({ id }).ready.catch(() => undefined)
  }

  return (
    <main>
      <header class="hero">
        <p class="eyebrow">Convex Pulse · Solid</p>
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
          <Show when={taskList().status === 'success'}>
            <span class="task-count">{taskList().data?.length}</span>
          </Show>
        </div>
        <form onSubmit={handleSubmit}>
          <input
            aria-label="Task title"
            onInput={(event) => setTitle(event.currentTarget.value)}
            placeholder="What needs doing?"
            value={title()}
          />
          <button type="submit">Add task</button>
        </form>
        <Show when={taskList().status === 'pending'}>
          <p class="state">Loading…</p>
        </Show>
        <Show when={taskList().status === 'error'}>
          <p class="state error" role="alert">
            {taskList().error?.message}
          </p>
        </Show>
        <Show
          when={
            taskList().status === 'success' && taskList().data?.length === 0
          }
        >
          <p class="state">No tasks yet. Add the first one.</p>
        </Show>
        <Show
          when={
            taskList().status === 'success' &&
            (taskList().data?.length ?? 0) > 0
          }
        >
          <ul class="task-list">
            <For each={taskList().data}>
              {(task) => (
                <li>
                  <A
                    href={`/tasks/${task._id}`}
                    onFocus={() => prefetch(task._id)}
                    onMouseEnter={() => prefetch(task._id)}
                  >
                    <span classList={{ done: task.done }}>{task.title}</span>
                    <span aria-hidden="true">↗</span>
                  </A>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </main>
  )
}

function Task() {
  const params = useParams<{ taskId: string }>()
  const task = createQuery(client, api.tasks.get, {
    args: { id: params.taskId as Id<'task'> }
  })
  const setDone = createMutation(client, api.tasks.setDone, {
    optimistic: ({ data, store }) =>
      store.get(api.tasks.get, { id: data.id }).merge({ done: data.done })
  })

  return (
    <main>
      <A class="back-link" href="/">
        ← All tasks
      </A>
      <article class="detail-card">
        <p class="eyebrow">Individual query</p>
        <Show when={task().status === 'pending'}>
          <p class="state">Loading task…</p>
        </Show>
        <Show when={task().status === 'error'}>
          <p class="state error" role="alert">
            {task().error?.message}
          </p>
        </Show>
        <Show when={task().status === 'success' && task().data}>
          {(value) => (
            <>
              <h1>{value().title}</h1>
              <label class="completion-control">
                <input
                  checked={value().done ?? false}
                  type="checkbox"
                  onChange={(event) =>
                    void setDone({
                      done: event.currentTarget.checked,
                      id: value()._id
                    })
                  }
                />
                <span>
                  <strong>{value().done ? 'Completed' : 'Open'}</strong>
                  <small>Synced live through Convex</small>
                </span>
              </label>
              <dl>
                <div>
                  <dt>Document ID</dt>
                  <dd>{value()._id}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{new Date(value()._creationTime).toLocaleString()}</dd>
                </div>
              </dl>
            </>
          )}
        </Show>
      </article>
    </main>
  )
}
