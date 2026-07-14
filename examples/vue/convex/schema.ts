import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  task: defineTable({
    done: v.optional(v.boolean()),
    title: v.string()
  })
})
