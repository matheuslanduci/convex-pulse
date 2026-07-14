import { expect, test } from '@playwright/test'

test('renders an Angular query result from a real Convex deployment', async ({
  page
}) => {
  await page.goto('/')

  await expect(page.getByText('Connected to Convex')).toBeVisible()
})

test('subscribes only while an Angular query signal is enabled', async ({
  page
}) => {
  const frameList: Record<string, unknown>[] = []
  page.on('websocket', (socket) => {
    socket.on('framesent', (event) => {
      if (typeof event.payload === 'string') {
        frameList.push(JSON.parse(event.payload) as Record<string, unknown>)
      }
    })
  })
  await page.goto('/?scenario=enabled-query')

  await expect(page.getByText('disabled', { exact: true })).toBeVisible()
  expect(countQueryModification(frameList, 'Add')).toBe(0)

  await page.getByRole('button', { name: 'Enable query' }).click()
  await expect(page.getByText('Connected to Convex')).toBeVisible()
  expect(countQueryModification(frameList, 'Add')).toBe(1)

  await page.getByRole('button', { name: 'Disable query' }).click()
  await expect(page.getByText('disabled', { exact: true })).toBeVisible()
  expect(countQueryModification(frameList, 'Remove')).toBe(1)
})

test('switches and skips reactive Angular query arguments', async ({
  page
}) => {
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
    page.getByText('Reactive query: angular-first, success')
  ).toBeVisible()
  expect(countQueryModification(frameList, 'Add')).toBe(1)

  await page.getByRole('button', { name: 'Switch arguments' }).click()
  await expect(
    page.getByText('Reactive query: angular-second, success')
  ).toBeVisible()
  expect(countQueryModification(frameList, 'Add')).toBe(2)
  expect(countQueryModification(frameList, 'Remove')).toBe(1)

  await page.getByRole('button', { name: 'Skip query' }).click()
  await expect(
    page.getByText('Reactive query: undefined, disabled')
  ).toBeVisible()
  expect(countQueryModification(frameList, 'Remove')).toBe(2)
})

test('throws Angular query errors to ErrorHandler', async ({ page }) => {
  await page.goto('/?scenario=throw-query')
  await expect(page.getByText(/Boundary:/u)).toContainText('E2E query error')
})

test('loads paginated Angular queries', async ({ page }) => {
  await page.goto('/?scenario=pagination')
  await expect(page.getByText('Pagination: angular-1, angular-2')).toBeVisible()
  await page.getByRole('button', { name: 'Load more' }).click()
  await expect(
    page.getByText(
      'Pagination: angular-1, angular-2, angular-3, angular-4, angular-5'
    )
  ).toBeVisible()
})

test('applies and confirms an Angular optimistic mutation', async ({
  page
}) => {
  await page.goto('/?scenario=optimistic')
  await expect(page.getByText('Query: null')).toBeVisible()

  await page.getByRole('button', { name: 'Update value' }).click()

  await expect(page.getByText('Query: changed in Angular')).toBeVisible()
  await expect(page.getByText('Mutation: changed in Angular')).toBeVisible()
  await expect(
    page.getByText('Option changes: null -> changed in Angular')
  ).toBeVisible()
  await expect(
    page.getByText('Hook changes: null -> changed in Angular')
  ).toBeVisible()
})

test('renders an Angular query error', async ({ page }) => {
  await page.goto('/?scenario=query-error')

  await expect(page.getByText(/E2E query error/u)).toBeVisible()
})

test('renders an Angular mutation error', async ({ page }) => {
  await page.goto('/?scenario=mutation-error')

  await page.getByRole('button', { name: 'Update value' }).click()

  await expect(page.getByText(/Mutation:/u)).toContainText('E2E mutation error')
  await expect(page.getByText(/Observable error:/u)).toContainText('error,')
  await expect(page.getByText(/Observable error:/u)).toContainText(
    'E2E mutation error'
  )
})

test('renders observable Angular mutation lifecycle state', async ({
  page
}) => {
  await page.goto('/?scenario=mutation-state')
  await expect(page.getByText('Mutation state: idle, false,')).toBeVisible()

  await page.getByRole('button', { name: 'Update value' }).click()
  await expect(page.getByText('Mutation state: pending, true,')).toBeVisible()
  await expect(page.getByText('Mutation events: mutate')).toBeVisible()

  await page.getByRole('button', { name: 'Complete mutation' }).click()
  await expect(
    page.getByText(
      'Mutation state: success, false, observable Angular mutation'
    )
  ).toBeVisible()
  await expect(page.getByText(/Mutation events:/u)).toContainText(
    'mutate, success:observable Angular mutation, settled:success'
  )

  await page.getByRole('button', { name: 'Reset mutation' }).click()
  await expect(page.getByText('Mutation state: idle, false,')).toBeVisible()
})

test('prefetches an Angular query from a real Convex deployment', async ({
  page
}) => {
  await page.goto('/?scenario=prefetch')

  await page.getByRole('button', { name: 'Prefetch value' }).click()

  await expect(page.getByText('Prefetch: null')).toBeVisible()
})

test('runs a real action through injectAction lifecycle state', async ({
  page
}) => {
  await page.goto('/?scenario=action-state')
  await expect(page.getByText('Action state: idle, false,')).toBeVisible()

  await page.getByRole('button', { name: 'Run action hook' }).click()
  await expect(
    page.getByText('Action state: success, false, observable Angular action')
  ).toBeVisible()
  await expect(
    page.getByText('Action event: success:observable Angular action')
  ).toBeVisible()

  await page.getByRole('button', { name: 'Reset action hook' }).click()
  await expect(page.getByText('Action state: idle, false,')).toBeVisible()
})

test('inspects Angular queries against a real Convex deployment', async ({
  page
}) => {
  await page.goto('/?scenario=devtools')
  await expect(page.locator('[data-convex-pulse-devtools]')).toBeAttached()
  await expect(page.getByText('Convex Pulse')).toBeVisible()
})

test('keeps framework internals out of the Angular browser entry point', async ({
  page
}) => {
  await page.goto('/?scenario=public-api')

  await expect(page.locator('body')).toContainText(
    'CONVEX_PULSE_CLIENT, ConvexPulseAngularClient, injectAction, injectMutation, injectOnDataChange, injectPrefetchQuery, injectQuery'
  )
})

test('authenticates from the Angular client options', async ({ page }) => {
  await page.goto('/?scenario=auth-options')

  await expect(page.getByText('Identity: Pulse E2E')).toBeVisible()
})

function countQueryModification(
  frameList: readonly Record<string, unknown>[],
  type: 'Add' | 'Remove'
) {
  return frameList
    .filter((frame) => frame.type === 'ModifyQuerySet')
    .flatMap((frame) => frame.modifications as Record<string, unknown>[])
    .filter((modification) => modification.type === type).length
}
