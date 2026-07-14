import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test('renders a Svelte query result from a real Convex deployment', async ({
  page
}) => {
  await page.goto('/')

  await expect(page.getByText('Connected to Convex')).toBeVisible()
})

test('subscribes only while a Svelte query is enabled', async ({ page }) => {
  await assertEnabledQueryLifecycle(page)
})

test('tracks reactive Svelte arguments, skip, context, and auth', async ({
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
  await page.goto('/?scenario=reactive-lifecycle')

  await expect(page.getByText('Reactive query: disabled')).toBeVisible()
  await expect(page.getByText('Rune pagination: rune-1, rune-2')).toBeVisible()
  const initialAddCount = countQueryModification(frameList, 'Add')

  await page.getByRole('button', { name: 'Load reactive query' }).click()
  await expect(page.getByText('Reactive query: success')).toBeVisible()
  expect(countQueryModification(frameList, 'Add')).toBe(initialAddCount + 1)

  await page.getByRole('button', { name: 'Skip reactive query' }).click()
  await expect(page.getByText('Reactive query: disabled')).toBeVisible()
  expect(countQueryModification(frameList, 'Remove')).toBe(1)

  await page.getByRole('button', { name: 'Sign in reactively' }).click()
  await expect(page.getByText('Reactive auth: authenticated')).toBeVisible()
  await page.getByRole('button', { name: 'Sign out reactively' }).click()
  await expect(page.getByText('Reactive auth: anonymous')).toBeVisible()
})

test('runs the public Svelte rune pagination and operation helpers', async ({
  page
}) => {
  await page.goto('/?scenario=reactive-lifecycle')

  await expect(page.getByText('Rune pagination: rune-1, rune-2')).toBeVisible()
  await page.getByRole('button', { name: 'Load more rune labels' }).click()
  await expect(
    page.getByText('Rune pagination: rune-1, rune-2, rune-3, rune-4, rune-5')
  ).toBeVisible()

  await page.getByRole('button', { name: 'Run rune mutation' }).click()
  await expect(
    page.getByText('Rune mutation: success, rune mutation')
  ).toBeVisible()

  await page.getByRole('button', { name: 'Run rune action' }).click()
  await expect(
    page.getByText('Rune action: success, rune action')
  ).toBeVisible()

  await page.getByRole('button', { name: 'Run rune prefetch' }).click()
  await expect(page.getByText('Rune prefetch: rune mutation')).toBeVisible()
})

test('loads paginated Svelte queries', async ({ page }) => {
  await page.goto('/?scenario=pagination')
  await expect(page.getByText('Pagination: svelte-1, svelte-2')).toBeVisible()
  await page.getByRole('button', { name: 'Load more' }).click()
  await expect(
    page.getByText(
      'Pagination: svelte-1, svelte-2, svelte-3, svelte-4, svelte-5'
    )
  ).toBeVisible()
})

test('applies and confirms a Svelte optimistic mutation', async ({ page }) => {
  await page.goto('/?scenario=optimistic')
  await expect(page.getByText('Query: null')).toBeVisible()

  await page.getByRole('button', { name: 'Update value' }).click()

  await expect(page.getByText('Query: changed in Svelte')).toBeVisible()
  await expect(page.getByText('Mutation: changed in Svelte')).toBeVisible()
  await expect(
    page.getByText('Option changes: null -> changed in Svelte')
  ).toBeVisible()
  await expect(
    page.getByText('Hook changes: null -> changed in Svelte')
  ).toBeVisible()
})

test('renders a Svelte query error', async ({ page }) => {
  await page.goto('/?scenario=query-error')

  await expect(page.getByText(/E2E query error/u)).toBeVisible()
})

test('renders a Svelte mutation error', async ({ page }) => {
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

test('renders observable Svelte mutation lifecycle state', async ({ page }) => {
  await assertMutationState(page, 'Svelte')
})

test('prefetches a Svelte query from a real Convex deployment', async ({
  page
}) => {
  await page.goto('/?scenario=prefetch')

  await page.getByRole('button', { name: 'Prefetch value' }).click()

  await expect(page.getByText('Prefetch: null')).toBeVisible()
})

test('inspects Svelte queries against a real Convex deployment', async ({
  page
}) => {
  await page.goto('/?scenario=devtools')
  await expect(page.locator('[data-convex-pulse-devtools]')).toBeAttached()
  await expect(page.getByText('Convex Pulse')).toBeVisible()
})

test('keeps framework internals out of the Svelte browser entry point', async ({
  page
}) => {
  await page.goto('/?scenario=public-api')

  await expect(page.locator('body')).toContainText(
    'ConvexPulseSvelteClient, closeConvex, createAction, createMutation, createPrefetchQuery, createPreloadedQuery, createQuery, getConvexClient, initConvex, onDataChange, setConvexClientContext, setupAuth, setupConvex, skipToken, useAction, useAuth, useConvexClient, useMutation, usePaginatedQuery, usePrefetchQuery, useQuery'
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
    page.getByText('Action state: success, false, observable Svelte action')
  ).toBeVisible()
  await expect(
    page.getByText('Action event: success:observable Svelte action')
  ).toBeVisible()

  await page.getByRole('button', { name: 'Reset action hook' }).click()
  await expect(
    page.getByText('Action state: idle, false, undefined')
  ).toBeVisible()
})

test('authenticates from the Svelte client options', async ({ page }) => {
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
