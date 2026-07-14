import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

test('hydrates a TanStack Start preloaded query and keeps it live', async ({
  page
}) => {
  const title = `TanStack Start ${randomUUID()}`
  const errorList: string[] = []
  page.on('pageerror', (error) => errorList.push(error.message))
  const response = await page.goto('/')
  expect(await response?.text()).toContain('Convex Pulse · TanStack Start')
  await expect(page.getByText('Loading')).toHaveCount(0)
  await expect(page.getByText('Hydrated: yes')).toBeVisible()
  expect(errorList).toEqual([])

  await page.getByRole('textbox', { name: 'Task title' }).fill(title)
  await page.getByRole('button', { name: 'Add task' }).click()

  const task = page.getByRole('listitem').filter({ hasText: title })
  await expect(task).toBeVisible()
  expect(errorList).toEqual([])
  await task.getByRole('button', { name: `Delete ${title}` }).click()
  await expect(task).toHaveCount(0)
})
