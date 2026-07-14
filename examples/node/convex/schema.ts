import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  task: defineTable({
    title: v.string()
  })
})
