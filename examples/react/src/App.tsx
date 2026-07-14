import {
  ConvexPulseDevtools,
  ConvexPulseReactClient,
  ConvexPulseReactProvider,
  useMutation,
  usePrefetchQuery,
  useQuery
} from 'convex-pulse/react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Route, Routes, useParams } from 'react-router-dom'

import { api } from '#convex/api'
import type { Id } from '#convex/dataModel'

import './App.css'

const client = new ConvexPulseReactClient(import.meta.env.VITE_CONVEX_URL, {
  gcTime: 60_000
})

export default function App() {
  return (
    <ConvexPulseReactProvider convex={client}>
      <div className="app-shell">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/tasks/:taskId" element={<Task />} />
        </Routes>
      </div>
      <ConvexPulseDevtools initialIsOpen />
    </ConvexPulseReactProvider>
  )
}

function Home() {
  const [title, setTitle] = useState('')
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedTitle = title.trim()
    if (!trimmedTitle) return

    void createTask({ title: trimmedTitle })
    setTitle('')
  }

  function prefetch(id: Id<'task'>) {
    void prefetchTask({ id }).ready.catch(() => undefined)
  }

  return (
    <main>
      <header className="hero">
        <p className="eyebrow">Convex Pulse · React</p>
        <h1>Small tasks, visible state.</h1>
        <p className="lede">
          Hover a task to prefetch it, open it to subscribe, then come back to
          watch the inactive query age in the inspector.
        </p>
      </header>

      <section className="task-card" aria-labelledby="tasks-heading">
        <div className="section-heading">
          <div>
            <p className="section-kicker">Cloud data</p>
            <h2 id="tasks-heading">Tasks</h2>
          </div>
          {taskList.status === 'success' && (
            <span className="task-count">{taskList.data.length}</span>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          <input
            aria-label="Task title"
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What needs doing?"
            value={title}
          />
          <button type="submit">Add task</button>
        </form>

        {taskList.status === 'pending' && <p className="state">Loading…</p>}
        {taskList.status === 'error' && (
          <p className="state error" role="alert">
            {taskList.error.message}
          </p>
        )}
        {taskList.status === 'success' && taskList.data.length === 0 && (
          <p className="state">No tasks yet. Add the first one.</p>
        )}
        {taskList.status === 'success' && taskList.data.length > 0 && (
          <ul className="task-list">
            {taskList.data.map((task) => (
              <li key={task._id}>
                <Link
                  to={`/tasks/${task._id}`}
                  onFocus={() => prefetch(task._id)}
                  onMouseEnter={() => prefetch(task._id)}
                >
                  <span className={task.done ? 'done' : undefined}>
                    {task.title}
                  </span>
                  <span aria-hidden="true">↗</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

function Task() {
  const { taskId } = useParams<{ taskId: string }>()
  const task = useQuery(api.tasks.get, {
    args: { id: taskId as Id<'task'> }
  })
  const setDone = useMutation(api.tasks.setDone, {
    optimistic: ({ data, store }) =>
      store.get(api.tasks.get, { id: data.id }).merge({ done: data.done })
  })

  return (
    <main>
      <Link className="back-link" to="/">
        ← All tasks
      </Link>
      <article className="detail-card">
        <p className="eyebrow">Individual query</p>
        {task.status === 'pending' && <p className="state">Loading task…</p>}
        {task.status === 'error' && (
          <p className="state error" role="alert">
            {task.error.message}
          </p>
        )}
        {task.status === 'success' && (
          <>
            <h1>{task.data.title}</h1>
            <label className="completion-control">
              <input
                checked={task.data.done ?? false}
                type="checkbox"
                onChange={(event) =>
                  void setDone({
                    done: event.target.checked,
                    id: task.data._id
                  })
                }
              />
              <span>
                <strong>{task.data.done ? 'Completed' : 'Open'}</strong>
                <small>Synced live through Convex</small>
              </span>
            </label>
            <dl>
              <div>
                <dt>Document ID</dt>
                <dd>{task.data._id}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{new Date(task.data._creationTime).toLocaleString()}</dd>
              </div>
            </dl>
          </>
        )}
      </article>
    </main>
  )
}
