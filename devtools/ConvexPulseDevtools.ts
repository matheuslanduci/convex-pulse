import type {
  DevtoolsAction,
  DevtoolsDeduplicatedMutation,
  DevtoolsHandle,
  DevtoolsMutation,
  DevtoolsOptimisticEvent,
  DevtoolsOptimisticLayer,
  DevtoolsQuery,
  DevtoolsSnapshot
} from '#client/Devtools.js'

const styles = `
  :host {
    all: initial;
    color-scheme: dark;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  * { box-sizing: border-box; }
  button { font: inherit; }

  .trigger {
    align-items: center;
    background: #1c1c1c;
    border: 1px solid #333;
    border-radius: 0;
    box-shadow: 0 16px 32px -12px rgb(0 0 0 / 60%), 0 2px 4px rgb(0 0 0 / 24%);
    color: #f5f5f5;
    cursor: pointer;
    display: flex;
    font-size: 11px;
    font-weight: 650;
    gap: 9px;
    letter-spacing: .02em;
    padding: 7px 11px 7px 7px;
    position: fixed;
    z-index: 2147483647;
  }

  .position-bottom-right .trigger { bottom: 20px; right: 20px; }
  .position-bottom-left .trigger { bottom: 20px; left: 20px; }
  .position-top-right .trigger { right: 20px; top: 20px; }
  .position-top-left .trigger { left: 20px; top: 20px; }

  .pulse-mark {
    align-items: center;
    background: #fa7319;
    color: white;
    display: inline-flex;
    font-family: Georgia, serif;
    font-size: 15px;
    height: 27px;
    justify-content: center;
    line-height: 1;
    width: 27px;
  }
  .pulse-mark svg { height: 18px; width: 14px; }

  .panel {
    background: #171717;
    border: 1px solid #333;
    border-radius: 0;
    box-shadow: 0 32px 64px -20px rgb(0 0 0 / 80%), 0 8px 24px -8px rgb(0 0 0 / 56%);
    color: #ebebeb;
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    height: min(740px, calc(100vh - 106px));
    overflow: hidden;
    position: fixed;
    width: min(760px, calc(100vw - 40px));
    z-index: 2147483647;
  }

  .position-bottom-right .panel { bottom: 72px; right: 20px; }
  .position-bottom-left .panel { bottom: 72px; left: 20px; }
  .position-top-right .panel { right: 20px; top: 72px; }
  .position-top-left .panel { left: 20px; top: 72px; }

  .panel-header {
    align-items: center;
    border-bottom: 1px solid #2b2b2b;
    display: flex;
    gap: 14px;
    min-height: 72px;
    padding: 14px 16px;
  }

  .brand { align-items: center; display: flex; gap: 12px; min-width: 0; }
  .brand-copy { display: grid; gap: 2px; }
  .brand-title { color: #f7f7f7; font-size: 13px; font-weight: 650; letter-spacing: -.01em; white-space: nowrap; }
  .brand-subtitle { color: #7b7b7b; font-size: 10px; letter-spacing: .01em; white-space: nowrap; }

  .connection {
    align-items: center;
    background: #1c1c1c;
    border: 0;
    border-radius: 0;
    color: #a3a3a3;
    display: inline-flex;
    font-size: 9px;
    font-weight: 650;
    gap: 7px;
    letter-spacing: .06em;
    margin-left: auto;
    padding: 6px 9px;
    text-transform: uppercase;
  }

  .connection::before { background: #f6b51e; border-radius: 50%; content: ""; height: 6px; width: 6px; }
  .connection.connected::before { background: #1fc16b; box-shadow: 0 0 0 3px rgb(31 193 107 / 10%); }
  .connection.disconnected::before { background: #fb3748; box-shadow: 0 0 0 3px rgb(251 55 72 / 10%); }

  .icon-button {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: 0;
    color: #7b7b7b;
    cursor: pointer;
    display: inline-flex;
    font-size: 19px;
    height: 32px;
    justify-content: center;
    transition: background 140ms ease, color 140ms ease;
    width: 32px;
  }
  .icon-button:hover { color: #fff; }

  .tabs {
    border-bottom: 1px solid #2b2b2b;
    display: flex;
    gap: 6px;
    padding: 8px 14px;
  }

  .tab {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: 0;
    color: #7b7b7b;
    cursor: pointer;
    display: inline-flex;
    font-size: 11px;
    font-weight: 620;
    padding: 7px 10px;
    transition: 140ms ease;
  }
  .tab:hover { color: #d1d1d1; }
  .tab.active { background: #262626; box-shadow: inset 0 -2px #fa7319; color: #f7f7f7; }

  .count { background: #333; border-radius: 0; color: #a3a3a3; font-size: 9px; margin-left: 7px; min-width: 18px; padding: 2px 5px; text-align: center; }
  .trigger > .count { background: #fa7319; color: white; }

  .content {
    align-content: start;
    display: grid;
    gap: 8px;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 12px;
    scrollbar-color: #333 transparent;
  }

  .entry {
    background: #1c1c1c;
    border: 0;
    border-radius: 0;
    transition: background 150ms ease;
  }
  .entry:hover, .entry[open] { background: #222; }

  .entry-summary {
    align-items: center;
    cursor: pointer;
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr) auto;
    list-style: none;
    min-height: 52px;
    padding: 10px 12px 10px 14px;
  }
  .entry-summary::-webkit-details-marker { display: none; }

  .entry-title {
    color: #ebebeb;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 11px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .entry-meta { align-items: center; display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
  .badge {
    background: #262626;
    border: 0;
    border-radius: 0;
    color: #a3a3a3;
    font-size: 8px;
    font-weight: 650;
    letter-spacing: .06em;
    padding: 4px 7px;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .badge.success { background: rgb(31 193 107 / 10%); color: #3ee089; }
  .badge.error { background: rgb(251 55 72 / 10%); color: #ff6875; }
  .badge.sent { background: rgb(51 92 255 / 10%); color: #97baff; }
  .badge.pending, .badge.queued, .badge.awaiting-transition { background: rgb(250 115 25 / 10%); color: #ffa468; }

  .timer { color: #7b7b7b; font-size: 9px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .details { border-top: 1px solid #333; display: grid; gap: 12px; padding: 12px 14px 14px; }
  .detail-label { color: #7b7b7b; font-size: 8px; font-weight: 650; letter-spacing: .1em; margin: 0 0 6px; text-transform: uppercase; }

  pre {
    background: #111;
    border: 0;
    border-radius: 0;
    color: #d1d1d1;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 10px;
    line-height: 1.6;
    margin: 0;
    max-height: 200px;
    overflow: auto;
    padding: 10px 11px;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .empty { align-items: center; color: #7b7b7b; display: flex; flex-direction: column; font-size: 11px; gap: 6px; justify-content: center; min-height: 230px; text-align: center; }
  .empty strong { color: #d1d1d1; font-size: 12px; }

  .footer { background: #111; border-top: 1px solid #2b2b2b; color: #7b7b7b; font-size: 9px; overflow: hidden; padding: 8px 14px; text-overflow: ellipsis; white-space: nowrap; }

  @media (max-width: 600px) {
    .panel { height: calc(100vh - 16px); left: 0 !important; right: 0 !important; width: 100vw; }
    .position-bottom-right .panel, .position-bottom-left .panel { bottom: 0; }
    .position-top-right .panel, .position-top-left .panel { top: 0; }
    .position-bottom-right .trigger { bottom: 12px; right: 12px; }
    .position-bottom-left .trigger { bottom: 12px; left: 12px; }
    .position-top-right .trigger { right: 12px; top: 12px; }
    .position-top-left .trigger { left: 12px; top: 12px; }
    .brand-subtitle { display: none; }
    .entry-summary { align-items: start; grid-template-columns: 1fr; }
    .entry-meta { justify-content: flex-start; }
  }
`

export class ConvexPulseDevtools {
  readonly #handle: DevtoolsHandle
  readonly #position: ConvexPulseDevtoolsPosition
  readonly #styleNonce: string | undefined
  #activeTab: DevtoolsTab = 'queries'
  #document: Document | null = null
  #host: HTMLDivElement | null = null
  #interval: ReturnType<typeof setInterval> | null = null
  #isOpen: boolean
  #release: (() => void) | null = null
  #root: ShadowRoot | null = null

  constructor(
    target: ConvexPulseDevtoolsTarget,
    options: ConvexPulseDevtoolsOptions = {}
  ) {
    this.#handle = 'devtools' in target ? target.devtools : target
    this.#isOpen = options.initialIsOpen ?? false
    this.#position = options.position ?? 'bottom-right'
    this.#styleNonce = options.styleNonce
  }

  mount(container?: HTMLElement) {
    if (this.#host !== null) {
      throw new Error('Convex Pulse DevTools is already mounted')
    }

    const ownerDocument = container?.ownerDocument ?? globalThis.document
    const mountTarget = container ?? ownerDocument?.body
    if (ownerDocument === undefined || mountTarget === undefined) {
      throw new Error('Convex Pulse DevTools requires a browser document')
    }

    this.#document = ownerDocument
    this.#host = ownerDocument.createElement('div')
    this.#host.dataset.convexPulseDevtools = ''
    this.#host.dataset.position = this.#position
    this.#root = this.#host.attachShadow({ mode: 'open' })
    mountTarget.append(this.#host)
    this.#release = this.#handle.subscribe(() => this.#render())
    this.#interval = globalThis.setInterval(() => this.#updateTimers(), 250)
    this.#render()

    return this
  }

  unmount() {
    this.#release?.()
    this.#release = null
    if (this.#interval !== null) {
      globalThis.clearInterval(this.#interval)
      this.#interval = null
    }
    this.#host?.remove()
    this.#document = null
    this.#host = null
    this.#root = null
  }

  open() {
    this.#isOpen = true
    this.#render()
  }

  close() {
    this.#isOpen = false
    this.#render()
  }

  toggle() {
    this.#isOpen = !this.#isOpen
    this.#render()
  }

  #render() {
    if (this.#root === null || this.#document === null) {
      return
    }

    const snapshot = this.#handle.getSnapshot()
    const style = this.#document.createElement('style')
    style.textContent = styles
    if (this.#styleNonce !== undefined) {
      style.nonce = this.#styleNonce
    }

    const shell = this.#element('div', `shell position-${this.#position}`)
    if (this.#isOpen) {
      shell.append(this.#panel(snapshot))
    }
    shell.append(this.#trigger(snapshot))
    this.#root.replaceChildren(style, shell)
    this.#updateTimers()
  }

  #trigger(snapshot: DevtoolsSnapshot) {
    const button = this.#element('button', 'trigger')
    button.type = 'button'
    button.setAttribute('aria-label', 'Toggle Convex Pulse DevTools')
    button.setAttribute('aria-expanded', String(this.#isOpen))
    button.addEventListener('click', () => this.toggle())
    button.append(this.#mark(), this.#document?.createTextNode('Pulse') as Text)

    const pendingOperationCount =
      snapshot.mutations.filter((mutation) =>
        ConvexPulseDevtools.#isPendingMutation(mutation)
      ).length +
      snapshot.actions.filter((action) =>
        ConvexPulseDevtools.#isPendingAction(action)
      ).length
    if (pendingOperationCount > 0) {
      button.append(
        this.#element('span', 'count', String(pendingOperationCount))
      )
    }
    return button
  }

  #panel(snapshot: DevtoolsSnapshot) {
    const panel = this.#element('section', 'panel')
    panel.setAttribute('aria-label', 'Convex Pulse DevTools')
    panel.append(
      this.#header(snapshot),
      this.#tabs(snapshot),
      this.#content(snapshot)
    )

    if (
      snapshot.connection === 'disconnected' &&
      snapshot.lastCloseReason !== null
    ) {
      panel.append(
        this.#element(
          'div',
          'footer',
          `Last disconnect: ${snapshot.lastCloseReason}`
        )
      )
    }
    return panel
  }

  #header(snapshot: DevtoolsSnapshot) {
    const header = this.#element('header', 'panel-header')
    const brand = this.#element('div', 'brand')
    const copy = this.#element('div', 'brand-copy')
    copy.append(
      this.#element('div', 'brand-title', 'Convex Pulse DevTools'),
      this.#element('div', 'brand-subtitle', 'Live client state inspector')
    )
    brand.append(this.#mark(), copy)

    const connection = this.#element(
      'span',
      `connection ${snapshot.connection}`,
      snapshot.connection
    )
    const close = this.#element('button', 'icon-button', '×')
    close.type = 'button'
    close.setAttribute('aria-label', 'Close Convex Pulse DevTools')
    close.addEventListener('click', () => this.close())
    header.append(brand, connection, close)
    return header
  }

  #tabs(snapshot: DevtoolsSnapshot) {
    const tabs = this.#element('div', 'tabs')
    tabs.setAttribute('role', 'tablist')
    tabs.append(
      this.#tab('queries', 'Queries', snapshot.queries.length),
      this.#tab('mutations', 'Mutations', snapshot.mutations.length),
      this.#tab('actions', 'Actions', snapshot.actions.length),
      this.#tab(
        'optimistic',
        'Optimistic',
        snapshot.optimisticLayers.length + snapshot.deduplicatedMutations.length
      )
    )
    return tabs
  }

  #tab(tab: DevtoolsTab, label: string, count: number) {
    const button = this.#element(
      'button',
      `tab${this.#activeTab === tab ? ' active' : ''}`
    )
    button.type = 'button'
    button.setAttribute('role', 'tab')
    button.setAttribute('aria-selected', String(this.#activeTab === tab))
    button.append(
      this.#document?.createTextNode(label) as Text,
      this.#element('span', 'count', String(count))
    )
    button.addEventListener('click', () => {
      this.#activeTab = tab
      this.#render()
    })
    return button
  }

  #content(snapshot: DevtoolsSnapshot) {
    const content = this.#element('div', 'content')
    if (this.#activeTab === 'queries') {
      if (snapshot.queries.length === 0) {
        content.append(
          this.#empty('No cached queries', 'Mount a query to inspect it here.')
        )
      } else {
        content.append(...snapshot.queries.map((query) => this.#query(query)))
      }
      return content
    }

    if (this.#activeTab === 'actions') {
      if (snapshot.actions.length === 0) {
        content.append(
          this.#empty(
            'No action history',
            'Actions will appear here as they run.'
          )
        )
      } else {
        content.append(
          ...snapshot.actions.map((action) => this.#action(action))
        )
      }
      return content
    }

    if (this.#activeTab === 'optimistic') {
      if (
        snapshot.optimisticLayers.length === 0 &&
        snapshot.deduplicatedMutations.length === 0 &&
        snapshot.optimisticEvents.length === 0
      ) {
        content.append(
          this.#empty(
            'No optimistic work',
            'Optimistic layers and deduplicated calls will appear here.'
          )
        )
      } else {
        content.append(
          ...snapshot.optimisticLayers.map((layer) =>
            this.#optimisticLayer(layer)
          ),
          ...snapshot.deduplicatedMutations.map((mutation) =>
            this.#deduplicatedMutation(mutation)
          ),
          ...snapshot.optimisticEvents.map((event) =>
            this.#optimisticEvent(event)
          )
        )
      }
      return content
    }

    if (snapshot.mutations.length === 0) {
      content.append(
        this.#empty(
          'No mutation history',
          'Mutations will appear here as they run.'
        )
      )
    } else {
      content.append(
        ...snapshot.mutations.map((mutation) => this.#mutation(mutation))
      )
    }
    return content
  }

  #query(query: DevtoolsQuery) {
    const details = this.#element('details', `entry ${query.status}`)
    const summary = this.#element('summary', 'entry-summary')
    const title = this.#element('div', 'entry-title', query.path)
    title.title = query.path
    const meta = this.#element('div', 'entry-meta')
    meta.append(
      this.#element('span', `badge ${query.status}`, query.status),
      this.#element(
        'span',
        'badge',
        query.subscriberCount === 0
          ? 'inactive'
          : `${query.subscriberCount} subscribed`
      )
    )
    if (query.optimisticLayerCount > 0) {
      meta.append(
        this.#element(
          'span',
          'badge pending',
          `${query.optimisticLayerCount} optimistic`
        )
      )
    }
    const timer = this.#element('span', 'timer')
    if (query.expiresAt === null) {
      timer.textContent = query.subscriberCount > 0 ? 'Live' : 'Retained'
    } else {
      timer.dataset.expiresAt = String(query.expiresAt)
    }
    meta.append(timer)
    summary.append(title, meta)

    const body = this.#element('div', 'details')
    body.append(this.#value('Arguments', query.args))
    if (query.status === 'success') {
      if (query.optimisticLayerCount > 0) {
        body.append(
          this.#value('Server data', query.serverData),
          this.#value('Rendered data', query.data)
        )
      } else {
        body.append(this.#value('Data', query.data))
      }
    } else if (query.status === 'error') {
      body.append(this.#value('Error', query.error))
    } else {
      body.append(this.#value('Data', 'Waiting for the first result'))
    }
    details.append(summary, body)
    return details
  }

  #mutation(mutation: DevtoolsMutation) {
    const details = this.#element('details', `entry ${mutation.phase}`)
    const summary = this.#element('summary', 'entry-summary')
    const title = this.#element('div', 'entry-title', mutation.path)
    title.title = mutation.path
    const meta = this.#element('div', 'entry-meta')
    meta.append(
      this.#element(
        'span',
        `badge ${mutation.phase}`,
        ConvexPulseDevtools.#mutationPhase(mutation.phase)
      ),
      this.#element('span', 'badge', `#${mutation.requestId}`)
    )
    const elapsed = this.#element('span', 'timer')
    elapsed.dataset.startedAt = String(mutation.startedAt)
    if (mutation.completedAt !== null) {
      elapsed.dataset.completedAt = String(mutation.completedAt)
    }
    meta.append(elapsed)
    summary.append(title, meta)
    const body = this.#element('div', 'details')
    body.append(this.#value('Arguments', mutation.args))
    if (mutation.phase === 'success') {
      body.append(this.#value('Result', mutation.result))
    } else if (mutation.phase === 'error') {
      body.append(this.#value('Error', mutation.error))
    }
    details.append(summary, body)
    return details
  }

  #action(action: DevtoolsAction) {
    const details = this.#element('details', `entry ${action.phase}`)
    const summary = this.#element('summary', 'entry-summary')
    const title = this.#element('div', 'entry-title', action.path)
    title.title = action.path
    const meta = this.#element('div', 'entry-meta')
    meta.append(
      this.#element('span', `badge ${action.phase}`, action.phase),
      this.#element('span', 'badge', `#${action.requestId}`)
    )
    const elapsed = this.#element('span', 'timer')
    elapsed.dataset.startedAt = String(action.startedAt)
    if (action.completedAt !== null) {
      elapsed.dataset.completedAt = String(action.completedAt)
    }
    meta.append(elapsed)
    summary.append(title, meta)
    const body = this.#element('div', 'details')
    body.append(this.#value('Arguments', action.args))
    if (action.phase === 'success') {
      body.append(this.#value('Result', action.result))
    } else if (action.phase === 'error') {
      body.append(this.#value('Error', action.error))
    }
    details.append(summary, body)
    return details
  }

  #optimisticLayer(layer: DevtoolsOptimisticLayer) {
    const details = this.#element('details', 'entry pending')
    const summary = this.#element('summary', 'entry-summary')
    const title = this.#element('div', 'entry-title', layer.path)
    const meta = this.#element('div', 'entry-meta')
    meta.append(
      this.#element('span', 'badge pending', `Layer ${layer.index + 1}`),
      this.#element(
        'span',
        'badge',
        layer.requestId === null ? 'preparing' : `#${layer.requestId}`
      )
    )
    const elapsed = this.#element('span', 'timer')
    elapsed.dataset.startedAt = String(layer.startedAt)
    meta.append(elapsed)
    summary.append(title, meta)
    const body = this.#element('div', 'details')
    body.append(
      this.#value('Mutation arguments', layer.args),
      this.#value('Ordered operations', layer.operations)
    )
    details.append(summary, body)
    return details
  }

  #deduplicatedMutation(mutation: DevtoolsDeduplicatedMutation) {
    const details = this.#element('details', 'entry pending')
    const summary = this.#element('summary', 'entry-summary')
    const title = this.#element('div', 'entry-title', mutation.path)
    const meta = this.#element('div', 'entry-meta')
    meta.append(
      this.#element('span', 'badge pending', 'deduplicated'),
      this.#element('span', 'badge', `${mutation.callerCount} callers`),
      this.#element('span', 'badge', `#${mutation.requestId}`)
    )
    summary.append(title, meta)
    const body = this.#element('div', 'details')
    body.append(this.#value('Deduplication key', mutation.key))
    details.append(summary, body)
    return details
  }

  #optimisticEvent(event: DevtoolsOptimisticEvent) {
    const details = this.#element('details', 'entry')
    const summary = this.#element('summary', 'entry-summary')
    const title = this.#element('div', 'entry-title', event.path)
    const meta = this.#element('div', 'entry-meta')
    meta.append(
      this.#element('span', 'badge', event.type),
      this.#element(
        'span',
        'badge',
        event.requestId === null ? 'no request' : `#${event.requestId}`
      )
    )
    const elapsed = this.#element('span', 'timer')
    elapsed.dataset.startedAt = String(event.at)
    elapsed.dataset.completedAt = String(event.at)
    meta.append(elapsed)
    summary.append(title, meta)
    const body = this.#element('div', 'details')
    if (event.queryPath !== null) {
      body.append(this.#value('Replayed over query', event.queryPath))
    }
    details.append(summary, body)
    return details
  }

  #value(label: string, value: unknown) {
    const wrapper = this.#element('div')
    wrapper.append(
      this.#element('p', 'detail-label', label),
      this.#element('pre', undefined, ConvexPulseDevtools.#formatValue(value))
    )
    return wrapper
  }

  #empty(title: string, message: string) {
    const empty = this.#element('div', 'empty')
    empty.append(
      this.#element('strong', undefined, title),
      this.#element('span', undefined, message)
    )
    return empty
  }

  #mark() {
    const mark = this.#element('span', 'pulse-mark')
    mark.setAttribute('aria-hidden', 'true')
    const icon = this.#document?.createElementNS(
      'http://www.w3.org/2000/svg',
      'svg'
    ) as SVGSVGElement
    icon.setAttribute('fill', 'none')
    icon.setAttribute('viewBox', '180 140 175 225')
    icon.setAttribute('stroke', 'currentColor')
    icon.setAttribute('stroke-linecap', 'round')
    icon.setAttribute('stroke-linejoin', 'round')
    icon.setAttribute('stroke-width', '11')
    for (const data of [
      'M191 202c0-29 23-51 52-51h36c38 0 64 28 64 65s-27 71-64 71h-30',
      'M191 353V239h46l21-46 17 71 17-27h24'
    ]) {
      const path = this.#document?.createElementNS(
        'http://www.w3.org/2000/svg',
        'path'
      ) as SVGPathElement
      path.setAttribute('d', data)
      icon.append(path)
    }
    mark.append(icon)
    return mark
  }

  #element<Tag extends keyof HTMLElementTagNameMap>(
    tag: Tag,
    className?: string,
    text?: string
  ) {
    const element = (this.#document as Document).createElement(tag)
    if (className !== undefined) {
      element.className = className
    }
    if (text !== undefined) {
      element.textContent = text
    }
    return element
  }

  #updateTimers() {
    if (this.#root === null) {
      return
    }
    const now = Date.now()
    for (const timer of this.#root.querySelectorAll<HTMLElement>(
      '[data-expires-at]'
    )) {
      timer.textContent = `Expires in ${ConvexPulseDevtools.#duration(
        Number(timer.dataset.expiresAt) - now
      )}`
    }
    for (const timer of this.#root.querySelectorAll<HTMLElement>(
      '[data-started-at]'
    )) {
      const { completedAt } = timer.dataset
      timer.textContent =
        completedAt === undefined
          ? `${ConvexPulseDevtools.#duration(
              now - Number(timer.dataset.startedAt)
            )} elapsed`
          : ConvexPulseDevtools.#duration(
              Number(completedAt) - Number(timer.dataset.startedAt)
            )
    }
  }

  static #duration(milliseconds: number) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    if (minutes === 0) {
      return `${seconds}s`
    }
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
  }

  static #mutationPhase(phase: DevtoolsMutation['phase']) {
    if (phase === 'awaiting-transition') {
      return 'settling'
    }
    return phase
  }

  static #isPendingMutation(mutation: DevtoolsMutation) {
    return mutation.phase !== 'error' && mutation.phase !== 'success'
  }

  static #isPendingAction(action: DevtoolsAction) {
    return action.phase !== 'error' && action.phase !== 'success'
  }

  static #formatValue(value: unknown) {
    const seen = new WeakSet<object>()
    try {
      const formatted = JSON.stringify(
        value,
        (_key, child: unknown) => {
          if (typeof child === 'bigint') {
            return `${child}n`
          }
          if (child instanceof Error) {
            return {
              message: child.message,
              name: child.name,
              stack: child.stack
            }
          }
          if (child instanceof ArrayBuffer) {
            return `ArrayBuffer(${child.byteLength})`
          }
          if (typeof child === 'object' && child !== null) {
            if (seen.has(child)) {
              return '[Circular]'
            }
            seen.add(child)
          }
          return child
        },
        2
      )
      return formatted ?? String(value)
    } catch {
      return String(value)
    }
  }
}

export function mountConvexPulseDevtools(
  target: ConvexPulseDevtoolsTarget,
  options: MountConvexPulseDevtoolsOptions = {}
) {
  const devtools = new ConvexPulseDevtools(target, options)
  devtools.mount(options.container)
  return devtools
}

export type ConvexPulseDevtoolsOptions = Readonly<{
  initialIsOpen?: boolean
  position?: ConvexPulseDevtoolsPosition
  styleNonce?: string
}>

export type MountConvexPulseDevtoolsOptions = ConvexPulseDevtoolsOptions &
  Readonly<{
    container?: HTMLElement
  }>

export type ConvexPulseDevtoolsTarget =
  | DevtoolsHandle
  | Readonly<{ devtools: DevtoolsHandle }>

export type ConvexPulseDevtoolsPosition =
  | 'bottom-left'
  | 'bottom-right'
  | 'top-left'
  | 'top-right'

type DevtoolsTab = 'actions' | 'mutations' | 'optimistic' | 'queries'
