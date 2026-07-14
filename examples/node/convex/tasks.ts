import { v } from 'convex/values'

import { action, mutation, query } from './_generated/server.js'

export const formatTitle = action({
  args: {
    title: v.string()
  },
  handler: (_context, args) => args.title.toLocaleUpperCase(),
  returns: v.string()
})

export const list = query({
  args: {},
  handler: async (context) => context.db.query('task').order('desc').collect(),
  returns: v.array(
    v.object({
      _creationTime: v.number(),
      _id: v.id('task'),
      title: v.string()
    })
  )
})

export const create = mutation({
  args: {
    title: v.string()
  },
  handler: async (context, args) =>
    context.db.insert('task', { title: args.title }),
  returns: v.id('task')
})
