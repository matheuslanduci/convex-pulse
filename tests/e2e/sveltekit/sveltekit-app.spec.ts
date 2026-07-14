import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

test('hydrates a SvelteKit preloaded query and keeps it live', async ({
  page
}) => {
  const title = `SvelteKit ${randomUUID()}`
  const errorList: string[] = []
  page.on('pageerror', (error) => errorList.push(error.message))
  const response = await page.goto('/')
  expect(await response?.text()).toContain('Convex Pulse · SvelteKit')
  expect(await response?.text()).toContain('Labels: ssr-label-1, ssr-label-2')
  await expect(page.getByText('Loading')).toHaveCount(0)
  await expect(page.getByText('Hydrated: yes')).toBeVisible()
  await expect(page.getByText('Skipped: disabled')).toBeVisible()
  expect(errorList).toEqual([])

  await page.getByRole('button', { name: 'Load more labels' }).click()
  await expect(
    page.getByText(
      'Labels: ssr-label-1, ssr-label-2, ssr-label-3, ssr-label-4, ssr-label-5'
    )
  ).toBeVisible()

  await page.getByRole('textbox', { name: 'Task title' }).fill(title)
  await page.getByRole('button', { name: 'Add task' }).click()

  const task = page.getByRole('listitem').filter({ hasText: title })
  await expect(task).toBeVisible()
  expect(errorList).toEqual([])
  await task.getByRole('button', { name: `Delete ${title}` }).click()
  await expect(task).toHaveCount(0)
})
