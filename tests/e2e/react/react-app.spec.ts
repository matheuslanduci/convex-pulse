import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test('renders a query result from a real Convex deployment', async ({
  page
}) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', { name: 'Convex Pulse' })
  ).toBeVisible()
  await expect(page.getByText('Connected to Convex')).toBeVisible()
  await expect(page.getByText('Connecting…')).toHaveCount(0)
})

test('shares one live core subscription between equivalent React consumers', async ({
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
  await page.goto('/?scenario=shared-query')

  await expect(page.getByText('First: null')).toBeVisible()
  await expect(page.getByText('Second: null')).toBeVisible()
  const addCount = countQueryModification(frameList, 'Add')
  const removeCount = countQueryModification(frameList, 'Remove')

  expect(addCount).toBeGreaterThan(0)
  expect(addCount - removeCount).toBe(1)
})

test('subscribes only while a React query is enabled', async ({ page }) => {
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
})

test('loads and combines real paginated query pages through useQuery', async ({
  page
}) => {
  await page.goto('/?scenario=pagination')

  await expect(page.getByText('Pagination status: success')).toBeVisible()
  await expect(page.getByText('Pagination data: item-1, item-2')).toBeVisible()
  await expect(page.getByText('Pagination more: yes')).toBeVisible()
  await expect(page.getByText('Pagination loading more: no')).toBeVisible()

  await page.getByRole('button', { name: 'Load more' }).click()

  await expect(page.getByText('Pagination loading more: yes')).toBeVisible()

  await expect(
    page.getByText('Pagination data: item-1, item-2, item-3, item-4, item-5')
  ).toBeVisible()
  await expect(page.getByText('Pagination loading: no')).toBeVisible()
  await expect(page.getByText('Pagination loading more: no')).toBeVisible()
  await expect(page.getByText('Pagination more: no')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Load more' })).toBeDisabled()
})

test('keeps the private framework client out of the browser entry point', async ({
  page
}) => {
  await page.goto('/?scenario=public-api')

  await expect(page.getByText('Runtime exports:')).toHaveText(
    'Runtime exports: ConvexPulseDevtools, ConvexPulseReactClient, ConvexPulseReactProvider, skipToken, useAction, useConvexPulseAuth, useMutation, useOnDataChange, usePrefetchQuery, usePreloadedQuery, useQuery'
  )
})

test('shows subscribed queries and their real cache expiration lifecycle', async ({
  page
}) => {
  await page.goto('/?scenario=devtools')

  await expect(
    page.getByRole('region', { name: 'Convex Pulse DevTools' })
  ).toBeVisible()
  await expect(page.getByText('fixture:getValue')).toBeVisible()
  await expect(page.getByText('1 subscribed')).toBeVisible()

  await page.getByRole('button', { name: 'Unmount query' }).click()

  await expect(page.getByText('inactive')).toBeVisible()
  await expect(page.getByText(/Expires in/u)).toBeVisible()
  await expect(page.getByText('No cached queries')).toBeVisible({
    timeout: 4000
  })
  await expect(page.getByText('fixture:getValue')).toHaveCount(0)
})

test('places DevTools at top-right and scrolls expanded query details', async ({
  page
}) => {
  await page.setViewportSize({ height: 320, width: 1200 })
  await page.goto('/?scenario=devtools')

  const host = page.locator('[data-convex-pulse-devtools]')
  await expect(host).toHaveAttribute('data-position', 'top-right')
  const panel = page.getByRole('region', { name: 'Convex Pulse DevTools' })
  const trigger = page.getByRole('button', {
    name: 'Toggle Convex Pulse DevTools'
  })
  await expect(panel).toBeVisible()
  await expect(trigger).toBeVisible()
  const panelBox = await panel.boundingBox()
  const triggerBox = await trigger.boundingBox()

  expect(panelBox?.x).toBe(420)
  expect(panelBox?.y).toBe(72)
  expect(triggerBox?.x).toBeGreaterThan(1000)
  expect(triggerBox?.y).toBe(20)

  await page.getByText('fixture:getValue').click()
  const scrollTop = await host.locator('.content').evaluate((content) => {
    content.scrollTop = content.scrollHeight
    return content.scrollTop
  })

  expect(scrollTop).toBeGreaterThan(0)
  await expect(page.getByText('Data', { exact: true })).toBeInViewport()
})

test('keeps a queued mutation in history after it is sent and settled', async ({
  page
}) => {
  await page.goto('/?scenario=devtools')
  await expect(page.getByText('DevTools query: success')).toBeVisible()

  await page.getByRole('button', { name: 'Queue mutation' }).click()
  await page.getByRole('tab', { name: /Mutations/u }).click()

  await expect(page.getByText('fixture:setValue')).toBeVisible()
  await expect(page.getByText('queued', { exact: true })).toBeVisible()

  await page.getByRole('tab', { name: /Optimistic/u }).click()
  await expect(page.getByText('Layer 1')).toBeVisible()
  await expect(page.getByText('2 callers')).toBeVisible()
  await page.getByText('Layer 1').click()
  await expect(page.getByText('Ordered operations')).toBeVisible()

  await page.getByRole('tab', { name: /Queries/u }).click()
  await page.getByText('fixture:getValue').click()
  await expect(page.getByText('Server data')).toBeVisible()
  await expect(page.getByText('Rendered data')).toBeVisible()

  await page.getByRole('button', { name: 'Send queued mutation' }).click()

  await page.getByRole('tab', { name: /Mutations/u }).click()

  await expect(
    page.getByText('Mutation result: sent from DevTools demo')
  ).toBeVisible()
  await expect(page.getByText('success', { exact: true })).toBeVisible()
  await expect(page.getByText('fixture:setValue')).toBeVisible()

  await page.getByRole('tab', { name: /Optimistic/u }).click()
  await expect(page.getByText('auth-removed', { exact: true })).toBeVisible()
})

test('keeps successful and failed actions in DevTools history', async ({
  page
}) => {
  await page.goto('/?scenario=devtools')

  await page.getByRole('button', { name: 'Run action' }).click()
  await expect(
    page.getByText('Action result: sent from DevTools action')
  ).toBeVisible()
  await page.getByRole('tab', { name: /Actions/u }).click()
  await expect(page.getByText('fixture:echoAction')).toBeVisible()
  await expect(page.getByText('success', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Fail action' }).click()
  await expect(
    page.locator('p').filter({ hasText: 'Action result:' })
  ).toContainText('E2E action error')
  await expect(page.getByText('fixture:throwActionError')).toBeVisible()
  await expect(page.getByText('error', { exact: true })).toBeVisible()
})

test('executes a mutation and renders the live query update', async ({
  page
}) => {
  await page.goto('/?scenario=live-update')
  await expect(page.getByText('Query: null')).toBeVisible()
  await expect(page.getByText('Option changes: none')).toBeVisible()
  await expect(page.getByText('Hook changes: none')).toBeVisible()

  await page.getByRole('button', { name: 'Update value' }).click()

  await expect(page.getByText('Mutation: changed in React')).toBeVisible()
  await expect(page.getByText('Query: changed in React')).toBeVisible()
  await expect(
    page.getByText('Option changes: null -> changed in React')
  ).toBeVisible()
  await expect(
    page.getByText('Hook changes: null -> changed in React')
  ).toBeVisible()
})

test('renders a Convex query error', async ({ page }) => {
  await page.goto('/?scenario=query-error')

  await expect(page.getByRole('alert')).toContainText('E2E query error')
})

test('reports a mutation error and keeps the client usable', async ({
  page
}) => {
  await page.goto('/?scenario=mutation-error')

  await page.getByRole('button', { name: 'Fail then recover' }).click()

  await expect(page.getByText(/Mutation error:/u)).toContainText(
    'E2E mutation error'
  )
  await expect(page.getByText(/Observable error:/u)).toContainText('error,')
  await expect(page.getByText(/Observable error:/u)).toContainText(
    'E2E mutation error'
  )
  await expect(page.getByText('Recovery: still open')).toBeVisible()
})

test('renders observable React mutation lifecycle state', async ({ page }) => {
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
    page.getByText('Mutation state: success, false, observable React mutation')
  ).toBeVisible()
  await expect(page.getByText(/Mutation events:/u)).toContainText(
    'mutate, success:observable React mutation, settled:success'
  )

  await page.getByRole('button', { name: 'Reset mutation' }).click()
  await expect(
    page.getByText('Mutation state: idle, false, undefined')
  ).toBeVisible()
})

test('warns before unload while mutations and actions are pending', async ({
  page
}) => {
  await page.goto('/?scenario=beforeunload')

  expect(await beforeUnloadIsPrevented(page)).toBe(false)

  await page.getByRole('button', { name: 'Start pending work' }).click()
  await expect(page.getByText('Mutation pending: yes')).toBeVisible()
  await expect(page.getByText('Action pending: yes')).toBeVisible()
  expect(await beforeUnloadIsPrevented(page)).toBe(true)

  await page.getByRole('button', { name: 'Complete pending work' }).click()
  await expect(page.getByText('Mutation pending: no')).toBeVisible()
  await expect(page.getByText('Action pending: no')).toBeVisible()
  expect(await beforeUnloadIsPrevented(page)).toBe(false)
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
    page.getByText('Action state: success, false, observable React action')
  ).toBeVisible()
  await expect(
    page.getByText('Action event: success:observable React action')
  ).toBeVisible()

  await page.getByRole('button', { name: 'Reset action hook' }).click()
  await expect(
    page.getByText('Action state: idle, false, undefined')
  ).toBeVisible()
})

test('prefetches a query from a real Convex deployment', async ({ page }) => {
  await page.goto('/?scenario=prefetch')

  await page.getByRole('button', { name: 'Prefetch value' }).click()

  await expect(page.getByText('Prefetch: null')).toBeVisible()
})

test('authenticates queries with a real Clerk token', async ({ page }) => {
  const frameList: Record<string, unknown>[] = []
  page.on('websocket', (socket) => {
    socket.on('framesent', (event) => {
      if (typeof event.payload === 'string') {
        frameList.push(JSON.parse(event.payload) as Record<string, unknown>)
      }
    })
  })
  await page.goto('/?scenario=auth')

  await page.waitForTimeout(150)
  await expect(page.getByText(/Auth:/u)).toHaveCount(0)
  await expect(page.getByText('Auth: authenticated')).toBeVisible()
  await expect(page.getByText('Required auth: success')).toBeVisible()
  await expect(page.getByText('Identity: Pulse E2E')).toBeVisible()
  const initialAddCount = countQueryModification(frameList, 'Add')
  const initialRemoveCount = countQueryModification(frameList, 'Remove')

  expect(initialRemoveCount).toBeLessThanOrEqual(2)

  await page.getByRole('button', { name: 'Clear auth' }).click()

  await expect(page.getByText('Auth: anonymous')).toBeVisible()
  await expect(page.getByText('Identity: anonymous')).toBeVisible()
  expect(countQueryModification(frameList, 'Add')).toBe(initialAddCount)
  expect(countQueryModification(frameList, 'Remove')).toBe(initialRemoveCount)
})

test('does not render an unsubscribed identity cache after auth changes', async ({
  page
}) => {
  await page.goto('/?scenario=auth-cache')

  await expect(page.getByText('Auth cache: authenticated')).toBeVisible()
  await expect(page.getByText('Cached identity: Pulse E2E')).toBeVisible()
  await page.getByRole('button', { name: 'Unsubscribe identity' }).click()
  await expect(page.getByText(/Cached identity:/u)).toHaveCount(0)

  await page.getByRole('button', { name: 'Clear cached auth' }).click()
  await expect(page.getByText('Auth cache: anonymous')).toBeVisible()
  await page.getByRole('button', { name: 'Resubscribe identity' }).click()

  await expect(page.getByText('Cached identity: anonymous')).toBeVisible()
  await expect(page.getByText(/Identity history:/u)).not.toContainText(
    'anonymous:Pulse E2E'
  )
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

function beforeUnloadIsPrevented(page: Page) {
  return page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    globalThis.dispatchEvent(event)
    return event.defaultPrevented
  })
}
