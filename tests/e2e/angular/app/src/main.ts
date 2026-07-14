import '@angular/compiler'
import { Component, ErrorHandler, signal } from '@angular/core'
import { bootstrapApplication } from '@angular/platform-browser'
import {
  CONVEX_PULSE_CLIENT,
  ConvexPulseAngularClient,
  injectAction,
  injectMutation,
  injectOnDataChange,
  injectPrefetchQuery,
  injectQuery
} from 'convex-pulse/angular'
import { mountConvexPulseDevtools } from 'convex-pulse/devtools'
import type { FunctionReference } from 'convex/server'

import { api } from '#convex/api'

const scenario = new URLSearchParams(location.search).get('scenario')
const client = new ConvexPulseAngularClient(
  import.meta.env.VITE_CONVEX_URL,
  scenario === 'auth-options' ? { fetchToken: fetchClerkToken } : {}
)
const runId = crypto.randomUUID()
if (scenario === 'devtools') {
  mountConvexPulseDevtools(client, { initialIsOpen: true })
}
const getValue = api.fixture.getValue as FunctionReference<
  'query',
  'public',
  { key: string; runId: string },
  string
>
const setValue = api.fixture.setValue as FunctionReference<
  'mutation',
  'public',
  { key: string; runId: string; value: string },
  string
>

const pulseErrorHandler = {
  handleError(error: unknown) {
    const output = document.createElement('p')
    output.textContent = `Boundary: ${errorMessage(error)}`
    document.body.append(output)
  }
}

class AppComponent {
  readonly actionEvent = signal('none')
  readonly mutationEvents = signal<string[]>([])
  readonly mutationResult = signal('not called')
  readonly hookChange = signal('none')
  readonly optionChange = signal('none')
  readonly prefetchResult = signal('not called')
  readonly queryEnabled = signal(scenario !== 'enabled-query')
  readonly reactiveKey = signal('')
  readonly runtimeExports = signal('loading')
  readonly query =
    scenario === 'query-error' || scenario === 'throw-query'
      ? injectQuery(api.fixture.throwQueryError, {
          args: {},
          throwOnError: scenario === 'throw-query'
        })
      : injectQuery(getValue, {
          args:
            scenario === 'reactive-query'
              ? () => {
                  const key = this.reactiveKey()
                  return key.length === 0 ? 'skip' : { key, runId }
                }
              : { key: 'angular-value', runId },
          enabled: this.queryEnabled.asReadonly(),
          onDataChange: ({ next, previous }) =>
            this.optionChange.set(`${previous} -> ${next}`),
          select: String
        })
  readonly dataChangeListener = injectOnDataChange(
    this.query,
    ({ next, previous }) => this.hookChange.set(`${previous} -> ${next}`)
  )
  readonly updateValue = injectMutation(setValue, {
    onMutate: () =>
      this.mutationEvents.update((current) => [...current, 'mutate']),
    onSettled: ({ error }) =>
      this.mutationEvents.update((current) => [
        ...current,
        error === null ? 'settled:success' : 'settled:error'
      ]),
    onSuccess: ({ data }) =>
      this.mutationEvents.update((current) => [...current, `success:${data}`]),
    optimistic: ({ data, store }) =>
      store
        .get(getValue, { key: data.key, runId: data.runId })
        .modify(data.value)
  })
  readonly failMutation = injectMutation(api.fixture.throwMutationError)
  readonly echoAction = injectAction(api.fixture.echoAction, {
    onSuccess: ({ data }) => this.actionEvent.set(`success:${String(data)}`)
  })
  readonly prefetchValue = injectPrefetchQuery(getValue)
  readonly paginationQuery = injectQuery(api.fixture.paginateLabels, {
    args: { prefix: 'angular' },
    enabled: scenario === 'pagination',
    pagination: { initialNumItems: 2 }
  })
  readonly identity = injectQuery(api.fixture.getIdentity, {
    args: {},
    enabled: scenario === 'auth-options'
  })

  constructor() {
    if (scenario === 'public-api') {
      void this.#loadPublicApi()
    }
  }

  get queryText() {
    const snapshot = this.query()

    if (scenario === 'reactive-query') {
      return `Reactive query: ${this.reactiveKey() || 'undefined'}, ${snapshot.status}`
    }
    if (scenario === 'query-error') {
      return snapshot.status === 'error'
        ? snapshot.error.message
        : snapshot.status
    }
    if (scenario === 'optimistic') {
      return `Query: ${snapshot.status === 'success' ? String(snapshot.data) : snapshot.status}`
    }

    return snapshot.status === 'success'
      ? 'Connected to Convex'
      : snapshot.status
  }

  async update() {
    if (scenario === 'mutation-error') {
      try {
        await this.failMutation()
      } catch (error) {
        this.mutationResult.set(errorMessage(error))
      }
      return
    }

    if (scenario === 'mutation-state') {
      client.setAuth(
        () =>
          new Promise<string | null>((resolve) => {
            globalThis.setTimeout(() => resolve(null), 60_000)
          })
      )
    }
    this.mutationResult.set(
      await this.updateValue({
        key: 'angular-value',
        runId,
        value:
          scenario === 'mutation-state'
            ? 'observable Angular mutation'
            : 'changed in Angular'
      })
    )
  }

  completeMutation() {
    if (this.updateValue.isPending) {
      client.clearAuth()
    }
  }

  resetMutation() {
    this.updateValue.reset()
  }

  async runAction() {
    await this.echoAction({ value: 'observable Angular action' })
  }

  resetAction() {
    this.echoAction.reset()
  }

  async prefetch() {
    const handle = this.prefetchValue({ key: 'angular-prefetch', runId })

    this.prefetchResult.set(String(await handle.ready))
  }

  toggleQuery() {
    this.queryEnabled.update((enabled) => !enabled)
  }

  loadFirstArguments() {
    this.reactiveKey.set('angular-first')
  }

  switchArguments() {
    this.reactiveKey.set('angular-second')
  }

  skipQuery() {
    this.reactiveKey.set('')
  }

  loadMore() {
    this.paginationQuery().loadMore(3)
  }

  async #loadPublicApi() {
    const publicApi = await import('convex-pulse/angular')

    this.runtimeExports.set(Object.keys(publicApi).toSorted().join(', '))
  }
}

Component({
  selector: 'app-root',
  standalone: true,
  template: `
    <p>{{ queryText }}</p>
    <p>Mutation: {{ mutationResult() }}</p>
    @if ('${scenario}' === 'optimistic') {
      <p>Option changes: {{ optionChange() }}</p>
      <p>Hook changes: {{ hookChange() }}</p>
    }
    @if ('${scenario}' === 'mutation-state') {
      <p>Mutation state: {{ updateValue.status }}, {{ updateValue.isPending }}, {{ updateValue.data }}</p>
      <p>Mutation events: {{ mutationEvents().join(', ') }}</p>
    }
    @if ('${scenario}' === 'mutation-error') {
      <p>Observable error: {{ failMutation.status }}, {{ failMutation.error?.message }}</p>
    }
    @if ('${scenario}' === 'action-state') {
      <p>Action state: {{ echoAction.status }}, {{ echoAction.isPending }}, {{ echoAction.data }}</p>
      <p>Action event: {{ actionEvent() }}</p>
      <button type="button" (click)="runAction()">Run action hook</button>
      <button type="button" (click)="resetAction()">Reset action hook</button>
    }
    <p>Prefetch: {{ prefetchResult() }}</p>
    <p>{{ runtimeExports() }}</p>
    @if ('${scenario}' === 'auth-options') {
      <p>Identity: {{ identity().status === 'success' ? identity().data?.name : identity().status }}</p>
    }
    @if ('${scenario}' === 'pagination') {
      <p>Pagination: {{ paginationQuery().data?.join(', ') }}</p>
      <button type="button" [disabled]="!paginationQuery().canLoadMore" (click)="loadMore()">Load more</button>
    }
    @if ('${scenario}' === 'reactive-query') {
      <button type="button" (click)="loadFirstArguments()">Load first arguments</button>
      <button type="button" (click)="switchArguments()">Switch arguments</button>
      <button type="button" (click)="skipQuery()">Skip query</button>
    }
    <button type="button" (click)="update()">Update value</button>
    <button type="button" (click)="completeMutation()">Complete mutation</button>
    <button type="button" (click)="resetMutation()">Reset mutation</button>
    <button type="button" (click)="prefetch()">Prefetch value</button>
    <button type="button" (click)="toggleQuery()">
      {{ queryEnabled() ? 'Disable query' : 'Enable query' }}
    </button>
  `
})(AppComponent)

void bootstrapApplication(AppComponent, {
  providers: [
    { provide: CONVEX_PULSE_CLIENT, useValue: client },
    { provide: ErrorHandler, useValue: pulseErrorHandler }
  ]
})

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function fetchClerkToken(_options: { forceRefreshToken: boolean }) {
  return Promise.resolve(import.meta.env.VITE_CLERK_E2E_TOKEN)
}
