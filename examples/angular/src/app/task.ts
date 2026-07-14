import { Component, inject } from '@angular/core'
import { ActivatedRoute, RouterLink } from '@angular/router'
import { injectMutation, injectQuery } from 'convex-pulse/angular'

import { api } from '#convex/api'
import type { Id } from '#convex/dataModel'

@Component({
  imports: [RouterLink],
  template: `<main>
    <a class="back-link" routerLink="/">← All tasks</a>
    <article class="detail-card">
      <p class="eyebrow">Individual query</p>
      @if (task().status === 'pending') {
        <p class="state">Loading task…</p>
      } @else if (task().status === 'error') {
        <p class="state error" role="alert">{{ task().error?.message }}</p>
      } @else if (task().data; as value) {
        <h1>{{ value.title }}</h1>
        <label class="completion-control"
          ><input
            [checked]="value.done ?? false"
            type="checkbox"
            (change)="toggle(value._id, $any($event.target).checked)"
          /><span
            ><strong>{{ value.done ? 'Completed' : 'Open' }}</strong
            ><small>Synced live through Convex</small></span
          ></label
        >
        <dl>
          <div>
            <dt>Document ID</dt>
            <dd>{{ value._id }}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{{ created(value._creationTime) }}</dd>
          </div>
        </dl>
      }
    </article>
  </main>`
})
export class Task {
  readonly #taskId = inject(ActivatedRoute).snapshot.paramMap.get(
    'taskId'
  ) as Id<'task'>
  protected readonly task = injectQuery(api.tasks.get, {
    args: { id: this.#taskId }
  })
  readonly #setDone = injectMutation(api.tasks.setDone, {
    optimistic: ({ data, store }) =>
      store.get(api.tasks.get, { id: data.id }).merge({ done: data.done })
  })

  protected toggle(id: Id<'task'>, done: boolean) {
    void this.#setDone({ done, id })
  }

  protected created(creationTime: number) {
    return new Date(creationTime).toLocaleString()
  }
}
