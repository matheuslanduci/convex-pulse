import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test('renders a Solid query result from a real Convex deployment', async ({
  page
}) => {
  await page.goto('/')

  await expect(page.getByText('Connected to Convex')).toBeVisible()
})

test('subscribes only while a Solid query is enabled', async ({ page }) => {
  await assertEnabledQueryLifecycle(page)
})

test('switches and skips reactive Solid query arguments', async ({ page }) => {
  await assertReactiveQueryLifecycle(page, 'Solid')
})

test('throws Solid query errors to the framework error path', async ({
  page
}) => {
  await page.goto('/?scenario=throw-query')
  await expect(page.getByText(/Boundary:/u)).toContainText('E2E query error')
})

test('loads paginated Solid queries', async ({ page }) => {
  await page.goto('/?scenario=pagination')
  await expect(page.getByText('Pagination: solid-1, solid-2')).toBeVisible()
  await page.getByRole('button', { name: 'Load more' }).click()
  await expect(
    page.getByText('Pagination: solid-1, solid-2, solid-3, solid-4, solid-5')
  ).toBeVisible()
})

test('applies and confirms a Solid optimistic mutation', async ({ page }) => {
  await page.goto('/?scenario=optimistic')
  await expect(page.getByText('Query: null')).toBeVisible()

  await page.getByRole('button', { name: 'Update value' }).click()

  await expect(page.getByText('Query: changed in Solid')).toBeVisible()
  await expect(page.getByText('Mutation: changed in Solid')).toBeVisible()
  await expect(
    page.getByText('Option changes: null -> changed in Solid')
  ).toBeVisible()
  await expect(
    page.getByText('Hook changes: null -> changed in Solid')
  ).toBeVisible()
})

test('renders a Solid query error', async ({ page }) => {
  await page.goto('/?scenario=query-error')

  await expect(page.getByText(/E2E query error/u)).toBeVisible()
})

test('renders a Solid mutation error', async ({ page }) => {
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

test('renders observable Solid mutation lifecycle state', async ({ page }) => {
  await assertMutationState(page, 'Solid')
})

test('prefetches a Solid query from a real Convex deployment', async ({
  page
}) => {
  await page.goto('/?scenario=prefetch')

  await page.getByRole('button', { name: 'Prefetch value' }).click()

  await expect(page.getByText('Prefetch: null')).toBeVisible()
})

test('inspects Solid queries against a real Convex deployment', async ({
  page
}) => {
  await page.goto('/?scenario=devtools')
  await expect(page.locator('[data-convex-pulse-devtools]')).toBeAttached()
  await expect(page.getByText('Convex Pulse')).toBeVisible()
})

test('keeps framework internals out of the Solid browser entry point', async ({
  page
}) => {
  await page.goto('/?scenario=public-api')

  await expect(page.locator('body')).toContainText(
    'ConvexPulseSolidClient, createAction, createMutation, createOnDataChange, createPrefetchQuery, createQuery'
  )
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

async function assertReactiveQueryLifecycle(page: Page, framework: string) {
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
    page.getByText(`Reactive query: ${framework.toLowerCase()}-first, success`)
  ).toBeVisible()
  expect(countQueryModification(frameList, 'Add')).toBe(1)

  await page.getByRole('button', { name: 'Switch arguments' }).click()
  await expect(
    page.getByText(`Reactive query: ${framework.toLowerCase()}-second, success`)
  ).toBeVisible()
  expect(countQueryModification(frameList, 'Add')).toBe(2)
  expect(countQueryModification(frameList, 'Remove')).toBe(1)

  await page.getByRole('button', { name: 'Skip query' }).click()
  await expect(
    page.getByText('Reactive query: undefined, disabled')
  ).toBeVisible()
  expect(countQueryModification(frameList, 'Remove')).toBe(2)
}

async function assertMutationState(page: Page, framework: string) {
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
    page.getByText(
      `Mutation state: success, false, observable ${framework} mutation`
    )
  ).toBeVisible()
  await expect(page.getByText(/Mutation events:/u)).toContainText(
    `mutate, success:observable ${framework} mutation, settled:success`
  )

  await page.getByRole('button', { name: 'Reset mutation' }).click()
  await expect(
    page.getByText('Mutation state: idle, false, undefined')
  ).toBeVisible()
}

test('runs a real action through createAction lifecycle state', async ({
  page
}) => {
  await page.goto('/?scenario=action-state')
  await expect(
    page.getByText('Action state: idle, false, undefined')
  ).toBeVisible()

  await page.getByRole('button', { name: 'Run action hook' }).click()
  await expect(
    page.getByText('Action state: success, false, observable Solid action')
  ).toBeVisible()
  await expect(
    page.getByText('Action event: success:observable Solid action')
  ).toBeVisible()

  await page.getByRole('button', { name: 'Reset action hook' }).click()
  await expect(
    page.getByText('Action state: idle, false, undefined')
  ).toBeVisible()
})

test('authenticates from the Solid client options', async ({ page }) => {
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
