import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { ConvexPulseHttpClient } from 'convex-pulse/http'
import { useMutation, usePreloadedQuery } from 'convex-pulse/react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import { api } from '#convex/api'

const loadTasks = createServerFn({ method: 'GET' }).handler(() => {
  const client = new ConvexPulseHttpClient(
    requiredEnvironmentVariable('VITE_CONVEX_URL', process.env.VITE_CONVEX_URL)
  )
  return client.preloadQuery(api.tasks.list, { args: {} })
})
export const Route = createFileRoute('/')({
  component: Home,
  loader: () => loadTasks()
})

function Home() {
  const preloadedTasks = Route.useLoaderData()

  return <TaskList preloadedTasks={preloadedTasks} />
}

function TaskList({ preloadedTasks }: TaskListProps) {
  const [title, setTitle] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const tasks = usePreloadedQuery(preloadedTasks)
  const createTask = useMutation(api.tasks.create)
  const removeTask = useMutation(api.tasks.remove)

  useEffect(() => setHydrated(true), [])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (trimmedTitle.length === 0) return

    void createTask({ title: trimmedTitle })
    setTitle('')
  }

  return (
    <main>
      <h1>Convex Pulse · TanStack Start</h1>
      <p>Hydrated: {hydrated ? 'yes' : 'no'}</p>
      <form onSubmit={handleSubmit}>
        <input
          aria-label="Task title"
          onChange={(event) => setTitle(event.target.value)}
          placeholder="What needs doing?"
          value={title}
        />
        <button type="submit">Add task</button>
      </form>
      {createTask.error === null ? null : (
        <p role="alert">{createTask.error.message}</p>
      )}
      {tasks.length === 0 ? (
        <p>No tasks yet.</p>
      ) : (
        <ul>
          {tasks.map((task) => (
            <li key={task._id}>
              {task.title}{' '}
              <button
                type="button"
                onClick={() => void removeTask({ id: task._id })}
              >
                Delete {task.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

function requiredEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) {
    throw new Error(`${name} is not set`)
  }
  return value
}

type TaskListProps = Readonly<{
  preloadedTasks: Awaited<ReturnType<typeof loadTasks>>
}>
