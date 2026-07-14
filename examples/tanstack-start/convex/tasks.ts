import {
  mutationGeneric as mutation,
  queryGeneric as query
} from 'convex/server'
import { v } from 'convex/values'

export const list = query({
  args: {},
  handler: (context) => context.db.query('task').order('asc').collect(),
  returns: v.array(
    v.object({
      _creationTime: v.number(),
      _id: v.id('task'),
      title: v.string()
    })
  )
})

export const create = mutation({
  args: { title: v.string() },
  handler: (context, args) => context.db.insert('task', args),
  returns: v.id('task')
})

export const remove = mutation({
  args: { id: v.id('task') },
  handler: (context, args) => context.db.delete(args.id),
  returns: v.null()
})
