import { expect, it, vi } from 'vitest'

import type { CoreQueryHandle, CoreQuerySnapshot } from '#client/QueryCore.js'
import { selectQueryHandle } from '#client/QuerySelector.js'

function createSource<Data>() {
  let snapshot: CoreQuerySnapshot<Data> = {
    data: undefined,
    error: null,
    isLoading: true,
    status: 'pending'
  }
  const listeners = new Set<() => void>()
  const handle: CoreQueryHandle<Data> = {
    getCacheGeneration: () => 0,
    getResult: () => null,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    subscribeWithCurrent: (listener) => {
      listeners.add(listener)
      if (snapshot.status !== 'pending') {
        listener()
      }
      return () => listeners.delete(listener)
    }
  }

  return {
    handle,
    publish(data: Data) {
      snapshot = { data, error: null, isLoading: false, status: 'success' }
      for (const listener of listeners) {
        listener()
      }
    }
  }
}

it('notifies only when the structurally selected value changes', () => {
  const source = createSource<readonly Task[]>()
  const selected = selectQueryHandle(source.handle, (tasks) =>
    tasks.filter((task) => !task.completed).map((task) => task.title)
  )
  const listener = vi.fn()
  selected.subscribe(listener)

  source.publish([{ completed: false, title: 'Buy milk' }])
  const firstSnapshot = selected.getSnapshot()
  expect(firstSnapshot).toMatchObject({
    data: ['Buy milk'],
    status: 'success'
  })

  source.publish([
    { completed: false, title: 'Buy milk' },
    { completed: true, title: 'Walk dog' }
  ])
  expect(listener).toHaveBeenCalledOnce()
  expect(selected.getSnapshot()).toBe(firstSnapshot)

  source.publish([
    { completed: false, title: 'Buy milk' },
    { completed: false, title: 'Walk dog' }
  ])
  expect(listener).toHaveBeenCalledTimes(2)
  expect(selected.getSnapshot()).toMatchObject({
    data: ['Buy milk', 'Walk dog'],
    status: 'success'
  })
})

it('surfaces selector errors and recovers on the next source value', () => {
  const source = createSource<number>()
  const selected = selectQueryHandle(source.handle, (value) => {
    if (value < 0) {
      throw new Error('Expected a non-negative value')
    }
    return value * 2
  })
  const listener = vi.fn()
  selected.subscribe(listener)

  source.publish(-1)
  expect(selected.getSnapshot()).toMatchObject({
    error: expect.objectContaining({
      message: 'Expected a non-negative value'
    }),
    status: 'error'
  })

  source.publish(2)
  expect(listener).toHaveBeenCalledTimes(2)
  expect(selected.getSnapshot()).toMatchObject({ data: 4, status: 'success' })
})

it('replays an unchanged selected result to a late current subscriber', () => {
  const source = createSource<Readonly<{ hidden: number; visible: string }>>()
  source.publish({ hidden: 1, visible: 'same' })
  const selected = selectQueryHandle(source.handle, (value) => value.visible)
  const listener = vi.fn()

  selected.subscribeWithCurrent(listener)
  expect(listener).toHaveBeenCalledOnce()
  expect(selected.getResult()).toEqual({ status: 'success', value: 'same' })
})

it('treats special numbers inside selected collections as unchanged', () => {
  const source = createSource<readonly number[]>()
  const selected = selectQueryHandle(source.handle, (value) => [...value])
  const listener = vi.fn()
  selected.subscribe(listener)

  source.publish([Number.NaN, -0])
  const snapshot = selected.getSnapshot()
  source.publish([Number.NaN, -0])

  expect(listener).toHaveBeenCalledOnce()
  expect(selected.getSnapshot()).toBe(snapshot)
})

type Task = Readonly<{
  completed: boolean
  title: string
}>
