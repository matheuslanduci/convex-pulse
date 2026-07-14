import { expect, it, vi } from 'vitest'

import { MutationController } from '#client/MutationState.js'

it('publishes mutation lifecycle state and resets successful data', async () => {
  const pending = deferred<string>()
  const onMutate = vi.fn()
  const onSuccess = vi.fn()
  const onSettled = vi.fn()
  const controller = new MutationController({
    mutation: () => pending.promise,
    onMutate,
    onSettled,
    onSuccess
  })

  const result = controller.execute({ value: 'done' })
  expect(controller.getSnapshot()).toEqual({
    data: undefined,
    error: null,
    isPending: true,
    status: 'pending'
  })
  expect(onMutate).toHaveBeenCalledWith({ args: { value: 'done' } })

  pending.resolve('saved')
  await expect(result).resolves.toBe('saved')
  expect(controller.getSnapshot()).toEqual({
    data: 'saved',
    error: null,
    isPending: false,
    status: 'success'
  })
  expect(onSuccess).toHaveBeenCalledWith({
    args: { value: 'done' },
    data: 'saved'
  })
  expect(onSettled).toHaveBeenCalledWith({
    args: { value: 'done' },
    data: 'saved',
    error: null
  })

  controller.reset()
  expect(controller.getSnapshot().status).toBe('idle')
})

it('publishes mutation errors and error lifecycle callbacks', async () => {
  const failure = new Error('Not allowed')
  const onError = vi.fn()
  const onSettled = vi.fn()
  const controller = new MutationController({
    mutation: () => Promise.reject(failure),
    onError,
    onSettled
  })

  await expect(controller.execute({ value: 'blocked' })).rejects.toBe(failure)
  expect(controller.getSnapshot()).toEqual({
    data: undefined,
    error: failure,
    isPending: false,
    status: 'error'
  })
  expect(onError).toHaveBeenCalledWith({
    args: { value: 'blocked' },
    error: failure
  })
  expect(onSettled).toHaveBeenCalledWith({
    args: { value: 'blocked' },
    data: undefined,
    error: failure
  })
})

it('keeps overlapping calls pending and lets the latest invocation win', async () => {
  const first = deferred<string>()
  const second = deferred<string>()
  const mutation = vi
    .fn<() => Promise<string>>()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
  const controller = new MutationController({ mutation })

  const firstResult = controller.execute('first')
  const secondResult = controller.execute('second')
  second.resolve('latest')
  await expect(secondResult).resolves.toBe('latest')
  expect(controller.getSnapshot().status).toBe('pending')

  first.resolve('older')
  await expect(firstResult).resolves.toBe('older')
  expect(controller.getSnapshot()).toEqual({
    data: 'latest',
    error: null,
    isPending: false,
    status: 'success'
  })
})

it('does not repopulate reset state when an earlier call settles', async () => {
  const pending = deferred<string>()
  const onSuccess = vi.fn()
  const controller = new MutationController({
    mutation: () => pending.promise,
    onSuccess
  })

  const result = controller.execute('value')
  controller.reset()
  pending.resolve('late')

  await expect(result).resolves.toBe('late')
  expect(controller.getSnapshot().status).toBe('idle')
  expect(onSuccess).toHaveBeenCalledOnce()
})

function deferred<Value>() {
  let resolvePromise!: (value: Value) => void
  let rejectPromise!: (error: unknown) => void
  const promise = new Promise<Value>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, reject: rejectPromise, resolve: resolvePromise }
}
