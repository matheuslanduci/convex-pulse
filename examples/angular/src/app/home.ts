import { Component, signal } from '@angular/core'
import { RouterLink } from '@angular/router'
import {
  injectMutation,
  injectPrefetchQuery,
  injectQuery
} from 'convex-pulse/angular'

import { api } from '#convex/api'
import type { Id } from '#convex/dataModel'

@Component({
  imports: [RouterLink],
  template: `
    <main>
      <header class="hero">
        <p class="eyebrow">Convex Pulse · Angular</p>
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
          @if (taskList().status === 'success') {
            <span class="task-count">{{ taskList().data?.length }}</span>
          }
        </div>
        <form (submit)="handleSubmit($event)">
          <input
            aria-label="Task title"
            placeholder="What needs doing?"
            [value]="title()"
            (input)="title.set($any($event.target).value)"
          />
          <button type="submit">Add task</button>
        </form>
        @if (taskList().status === 'pending') {
          <p class="state">Loading…</p>
        } @else if (taskList().status === 'error') {
          <p class="state error" role="alert">
            {{ taskList().error?.message }}
          </p>
        } @else if (taskList().data?.length === 0) {
          <p class="state">No tasks yet. Add the first one.</p>
        } @else {
          <ul class="task-list">
            @for (task of taskList().data; track task._id) {
              <li>
                <a
                  [routerLink]="['/tasks', task._id]"
                  (focus)="prefetch(task._id)"
                  (mouseenter)="prefetch(task._id)"
                  ><span [class.done]="task.done">{{ task.title }}</span
                  ><span aria-hidden="true">↗</span></a
                >
              </li>
            }
          </ul>
        }
      </section>
    </main>
  `
})
export class Home {
  protected readonly title = signal('')
  protected readonly taskList = injectQuery(api.tasks.list, { args: {} })
  readonly #prefetchTask = injectPrefetchQuery(api.tasks.get)
  readonly #createTask = injectMutation(api.tasks.create, {
    optimistic: ({ store, data, optimisticId }) =>
      store.get(api.tasks.list).append({
        _id: optimisticId,
        _creationTime: Date.now(),
        done: false,
        ...data
      })
  })

  protected handleSubmit(event: SubmitEvent) {
    event.preventDefault()
    const trimmedTitle = this.title().trim()
    if (!trimmedTitle) return
    void this.#createTask({ title: trimmedTitle })
    this.title.set('')
  }

  protected prefetch(id: Id<'task'>) {
    void this.#prefetchTask({ id }).ready.catch(() => undefined)
  }
}
