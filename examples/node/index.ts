import { ConvexPulseClient } from 'convex-pulse'

import { api } from '#convex/api'

const url = process.env.CONVEX_URL
if (!url) throw new Error('CONVEX_URL is required')

const convex = new ConvexPulseClient(url)

function listenToTasks() {
  return convex.onUpdate(api.tasks.list, { args: {} }, (tasks) =>
    console.log('Tasks changed:', tasks)
  )
}

async function createTask() {
  await convex.mutation(api.tasks.create, {
    args: {
      title: `Created from Node at ${new Date().toISOString()}`
    }
  })
}

async function queryTasks() {
  const tasks = await convex.query(api.tasks.list, { args: {} })
  console.log('Current tasks:', tasks)
}

async function formatTaskTitle() {
  const title = await convex.action(api.tasks.formatTitle, {
    args: { title: 'Created from a Convex action' }
  })

  console.log('Formatted title:', title)
}

listenToTasks()
await formatTaskTitle()
await createTask()
await queryTasks()
