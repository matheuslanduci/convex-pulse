import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  e2eValue: defineTable({
    key: v.string(),
    runId: v.string(),
    value: v.any()
  }).index('by_run_id_and_key', ['runId', 'key']),
  task: defineTable({ title: v.string() })
})
