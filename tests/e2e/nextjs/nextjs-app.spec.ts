import { randomUUID } from 'node:crypto'

import { expect, test } from '@playwright/test'

test('hydrates a Next.js preloaded query and keeps it live', async ({
  page
}) => {
  const title = `Next.js ${randomUUID()}`
  const response = await page.goto('/')
  expect(await response?.text()).toContain('Convex Pulse · Next.js')
  await expect(page.getByText('Loading')).toHaveCount(0)

  await page.getByRole('textbox', { name: 'Task title' }).fill(title)
  await page.getByRole('button', { name: 'Add task' }).click()

  const task = page.getByRole('listitem').filter({ hasText: title })
  await expect(task).toBeVisible()
  await task.getByRole('button', { name: `Delete ${title}` }).click()
  await expect(task).toHaveCount(0)
})
