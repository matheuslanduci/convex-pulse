import { expect, it, vi } from 'vitest'

import { ActionDeduper } from '#client/ActionDeduper.js'

it('shares an in-flight action for the same canonical dedupe value', async () => {
  const deduper = new ActionDeduper()
  const pending = deferred<string>()
  const action = vi.fn(() => pending.promise)
  const first = deduper.run('tasks:format', { a: 1, b: 2 }, action)
  const second = deduper.run(
    'tasks:format',
    Object.fromEntries([
      ['b', 2],
      ['a', 1]
    ]),
    action
  )

  expect(second).toBe(first)
  expect(action).toHaveBeenCalledOnce()

  pending.resolve('formatted')
  await expect(Promise.all([first, second])).resolves.toEqual([
    'formatted',
    'formatted'
  ])
})

it('starts a new action after success or failure releases the dedupe key', async () => {
  const deduper = new ActionDeduper()
  const failure = new Error('failed')
  const action = vi
    .fn<() => Promise<string>>()
    .mockRejectedValueOnce(failure)
    .mockResolvedValueOnce('retried')
    .mockResolvedValue('after clear')

  await expect(deduper.run('tasks:format', 'same', action)).rejects.toBe(
    failure
  )
  await expect(deduper.run('tasks:format', 'same', action)).resolves.toBe(
    'retried'
  )

  const pending = deduper.run('tasks:format', 'same', action)
  deduper.clear()
  const afterClear = deduper.run('tasks:format', 'same', action)

  expect(afterClear).not.toBe(pending)
  await expect(Promise.all([pending, afterClear])).resolves.toEqual([
    'after clear',
    'after clear'
  ])
  expect(action).toHaveBeenCalledTimes(4)
})

function deferred<Data>() {
  let rejectPromise!: (error: unknown) => void
  let resolvePromise!: (value: Data) => void
  const promise = new Promise<Data>((resolve, reject) => {
    rejectPromise = reject
    resolvePromise = resolve
  })
  return { promise, reject: rejectPromise, resolve: resolvePromise }
}
