'use client'

import { useMutation, usePreloadedQuery } from 'convex-pulse/react'
import type { PreloadedQuery } from 'convex-pulse/react'
import { useState } from 'react'
import type { FormEvent } from 'react'

import { ConvexClientProvider } from '#app/convex-client-provider'
import { api } from '#convex/api'

export function Tasks({ preloadedTasks }: TasksProps) {
  return (
    <ConvexClientProvider>
      <TaskList preloadedTasks={preloadedTasks} />
    </ConvexClientProvider>
  )
}

function TaskList({ preloadedTasks }: TasksProps) {
  const [title, setTitle] = useState('')
  const tasks = usePreloadedQuery(preloadedTasks)
  const createTask = useMutation(api.tasks.create)
  const removeTask = useMutation(api.tasks.remove)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (trimmedTitle.length === 0) return

    void createTask({ title: trimmedTitle })
    setTitle('')
  }

  return (
    <section aria-labelledby="tasks-heading">
      <h2 id="tasks-heading">Tasks</h2>
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
    </section>
  )
}

type TasksProps = Readonly<{
  preloadedTasks: PreloadedQuery<typeof api.tasks.list>
}>
