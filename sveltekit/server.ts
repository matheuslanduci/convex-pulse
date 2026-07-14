import { AsyncLocalStorage } from 'node:async_hooks'

import { setServerTokenGetter } from '#svelte/lifecycle.js'

const tokenStorage = new AsyncLocalStorage<string | undefined>()

setServerTokenGetter(() => tokenStorage.getStore())

export function withServerConvexToken<Result>(
  token: string | undefined,
  callback: () => Result
) {
  return tokenStorage.run(token, callback)
}
