import { v } from 'convex/values'

import { action, mutation, query } from './_generated/server.js'

const result = v.object({
  iteration: v.number(),
  payload: v.string(),
  serverTimestamp: v.number()
})

export const echoQuery = query({
  args: {
    iteration: v.number(),
    payload: v.string()
  },
  handler: async (context, args) => {
    if ((await context.auth.getUserIdentity()) === null) {
      throw new Error('Authentication required')
    }
    return { ...args, serverTimestamp: Date.now() }
  },
  returns: result
})

export const echoMutation = mutation({
  args: {
    iteration: v.number(),
    payload: v.string()
  },
  handler: async (context, args) => {
    if ((await context.auth.getUserIdentity()) === null) {
      throw new Error('Authentication required')
    }
    return { ...args, serverTimestamp: Date.now() }
  },
  returns: result
})

export const echoAction = action({
  args: {
    iteration: v.number(),
    payload: v.string()
  },
  handler: async (context, args) => {
    if ((await context.auth.getUserIdentity()) === null) {
      throw new Error('Authentication required')
    }
    return { ...args, serverTimestamp: Date.now() }
  },
  returns: result
})
