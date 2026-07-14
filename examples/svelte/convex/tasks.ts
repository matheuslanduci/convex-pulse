import { v } from 'convex/values'

import { mutation, query } from './_generated/server.js'

export const list = query({
  args: {},
  handler: async (context) => context.db.query('task').order('asc').collect(),
  returns: v.array(
    v.object({
      _creationTime: v.number(),
      _id: v.id('task'),
      done: v.optional(v.boolean()),
      title: v.string()
    })
  )
})

export const get = query({
  args: {
    id: v.id('task')
  },
  handler: async (context, args) => {
    const task = await context.db.get(args.id)
    if (task === null) {
      throw new Error('Task not found')
    }
    return task
  },
  returns: v.object({
    _creationTime: v.number(),
    _id: v.id('task'),
    done: v.optional(v.boolean()),
    title: v.string()
  })
})

export const create = mutation({
  args: {
    title: v.string()
  },
  handler: async (context, args) =>
    context.db.insert('task', { done: false, title: args.title }),
  returns: v.id('task')
})

export const setDone = mutation({
  args: {
    done: v.boolean(),
    id: v.id('task')
  },
  handler: async (context, args) => {
    await context.db.patch(args.id, { done: args.done })
    return null
  },
  returns: v.null()
})
