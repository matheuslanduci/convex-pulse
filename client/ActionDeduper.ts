import type { Value } from 'convex/values'

import { canonicalConvexValue } from '#client/valueCodec.js'

export class ActionDeduper {
  readonly #pending = new Map<string, Promise<unknown>>()

  run<Data>(
    path: string,
    dedupeValue: Value | undefined,
    action: () => Promise<Data>
  ): Promise<Data> {
    if (dedupeValue === undefined) {
      return action()
    }

    const key = JSON.stringify([path, canonicalConvexValue(dedupeValue)])
    const pending = this.#pending.get(key)
    if (pending !== undefined) {
      return pending as Promise<Data>
    }

    const promise = action()
    this.#pending.set(key, promise)
    void this.#release(key, promise)
    return promise
  }

  clear() {
    this.#pending.clear()
  }

  async #release(key: string, promise: Promise<unknown>) {
    try {
      await promise
    } catch {
      // The caller observes the original action rejection.
    } finally {
      if (this.#pending.get(key) === promise) {
        this.#pending.delete(key)
      }
    }
  }
}
