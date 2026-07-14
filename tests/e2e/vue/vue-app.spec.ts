import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test('renders a Vue query result from a real Convex deployment', async ({
  page
}) => {
  await page.goto('/')

  await expect(page.getByText('Connected to Convex')).toBeVisible()
})

test('subscribes only while a Vue query is enabled', async ({ page }) => {
  await assertEnabledQueryLifecycle(page)
})

test('switches and skips reactive Vue query arguments', async ({ page }) => {
  await assertReactiveQueryLifecycle(page)
})

test('throws Vue query errors to the framework error boundary', async ({
  page
}) => {
  await page.goto('/?scenario=throw-query')
  await expect(page.getByText(/Boundary:/u)).toContainText('E2E query error')
})

test('loads paginated Vue queries', async ({ page }) => {
  await page.goto('/?scenario=pagination')
  await expect(page.getByText('Pagination: vue-1, vue-2')).toBeVisible()
  await page.getByRole('button', { name: 'Load more' }).click()
  await expect(
    page.getByText('Pagination: vue-1, vue-2, vue-3, vue-4, vue-5')
  ).toBeVisible()
})

test('applies and confirms a Vue optimistic mutation', async ({ page }) => {
  await page.goto('/?scenario=optimistic')
  await expect(page.getByText('Query: null')).toBeVisible()

  await page.getByRole('button', { name: 'Update value' }).click()

  await expect(page.getByText('Query: changed in Vue')).toBeVisible()
  await expect(page.getByText('Mutation: changed in Vue')).toBeVisible()
  await expect(
    page.getByText('Option changes: null -> changed in Vue')
  ).toBeVisible()
  await expect(
    page.getByText('Hook changes: null -> changed in Vue')
  ).toBeVisible()
})

test('renders a Vue query error', async ({ page }) => {
  await page.goto('/?scenario=query-error')

  await expect(page.getByText(/E2E query error/u)).toBeVisible()
})

test('renders a Vue mutation error', async ({ page }) => {
  await page.goto('/?scenario=mutation-error')

  await page.getByRole('button', { name: 'Fail mutation' }).click()

  await expect(page.getByText(/Mutation error:/u)).toContainText(
    'E2E mutation error'
  )
  await expect(page.getByText(/Observable error:/u)).toContainText('error,')
  await expect(page.getByText(/Observable error:/u)).toContainText(
    'E2E mutation error'
  )
})

test('renders observable Vue mutation lifecycle state', async ({ page }) => {
  await page.goto('/?scenario=mutation-state')
  await expect(
    page.getByText('Mutation state: idle, false, undefined')
  ).toBeVisible()

  await page.getByRole('button', { name: 'Start mutation' }).click()
  await expect(
    page.getByText('Mutation state: pending, true, undefined')
  ).toBeVisible()
  await expect(page.getByText('Mutation events: mutate')).toBeVisible()

  await page.getByRole('button', { name: 'Complete mutation' }).click()
  await expect(
    page.getByText('Mutation state: success, false, observable Vue mutation')
  ).toBeVisible()
  await expect(page.getByText(/Mutation events:/u)).toContainText(
    'mutate, success:observable Vue mutation, settled:success'
  )

  await page.getByRole('button', { name: 'Reset mutation' }).click()
  await expect(
    page.getByText('Mutation state: idle, false, undefined')
  ).toBeVisible()
})

test('prefetches a Vue query from a real Convex deployment', async ({
  page
}) => {
  await page.goto('/?scenario=prefetch')

  await page.getByRole('button', { name: 'Prefetch value' }).click()

  await expect(page.getByText('Prefetch: null')).toBeVisible()
})

test('runs a real action through useAction lifecycle state', async ({
  page
}) => {
  await page.goto('/?scenario=action-state')
  await expect(
    page.getByText('Action state: idle, false, undefined')
  ).toBeVisible()

  await page.getByRole('button', { name: 'Run action hook' }).click()
  await expect(
    page.getByText('Action state: success, false, observable Vue action')
  ).toBeVisible()
  await expect(
    page.getByText('Action event: success:observable Vue action')
  ).toBeVisible()

  await page.getByRole('button', { name: 'Reset action hook' }).click()
  await expect(
    page.getByText('Action state: idle, false, undefined')
  ).toBeVisible()
})

test('inspects Vue queries against a real Convex deployment', async ({
  page
}) => {
  await page.goto('/?scenario=devtools')
  await expect(page.locator('[data-convex-pulse-devtools]')).toBeAttached()
  await expect(page.getByText('Convex Pulse')).toBeVisible()
})

test('keeps framework internals out of the Vue browser entry point', async ({
  page
}) => {
  await page.goto('/?scenario=public-api')

  await expect(page.locator('body')).toContainText(
    'ConvexPulseVueClient, ConvexPulseVueClientKey, provideConvexPulse, skipToken, useAction, useMutation, useOnDataChange, usePrefetchQuery, useQuery'
  )
})

test('authenticates from the Vue client options', async ({ page }) => {
  await page.goto('/?scenario=auth-options')

  await expect(page.getByText('Identity: Pulse E2E')).toBeVisible()
})

async function assertEnabledQueryLifecycle(page: Page) {
  const frameList: Record<string, unknown>[] = []
  page.on('websocket', (socket) => {
    socket.on('framesent', (event) => {
      if (typeof event.payload === 'string') {
        frameList.push(JSON.parse(event.payload) as Record<string, unknown>)
      }
    })
  })
  await page.goto('/?scenario=enabled-query')
  await expect(page.getByText('Enabled query: disabled')).toBeVisible()
  expect(countQueryModification(frameList, 'Add')).toBe(0)

  await page.getByRole('button', { name: 'Enable query' }).click()
  await expect(page.getByText('Enabled query: success')).toBeVisible()
  expect(countQueryModification(frameList, 'Add')).toBe(1)

  await page.getByRole('button', { name: 'Disable query' }).click()
  await expect(page.getByText('Enabled query: disabled')).toBeVisible()
  expect(countQueryModification(frameList, 'Remove')).toBe(1)
}

async function assertReactiveQueryLifecycle(page: Page) {
  const frameList: Record<string, unknown>[] = []
  page.on('websocket', (socket) => {
    socket.on('framesent', (event) => {
      if (typeof event.payload === 'string') {
        frameList.push(JSON.parse(event.payload) as Record<string, unknown>)
      }
    })
  })
  await page.goto('/?scenario=reactive-query')
  await expect(
    page.getByText('Reactive query: undefined, disabled')
  ).toBeVisible()
  expect(countQueryModification(frameList, 'Add')).toBe(0)

  await page.getByRole('button', { name: 'Load first arguments' }).click()
  await expect(
    page.getByText('Reactive query: vue-first, success')
  ).toBeVisible()
  expect(countQueryModification(frameList, 'Add')).toBe(1)

  await page.getByRole('button', { name: 'Switch arguments' }).click()
  await expect(
    page.getByText('Reactive query: vue-second, success')
  ).toBeVisible()
  expect(countQueryModification(frameList, 'Add')).toBe(2)
  expect(countQueryModification(frameList, 'Remove')).toBe(1)

  await page.getByRole('button', { name: 'Skip query' }).click()
  await expect(
    page.getByText('Reactive query: undefined, disabled')
  ).toBeVisible()
  expect(countQueryModification(frameList, 'Remove')).toBe(2)
}

function countQueryModification(
  frameList: readonly Record<string, unknown>[],
  type: 'Add' | 'Remove'
) {
  return frameList
    .filter((frame) => frame.type === 'ModifyQuerySet')
    .flatMap((frame) => frame.modifications as Record<string, unknown>[])
    .filter((modification) => modification.type === type).length
}
