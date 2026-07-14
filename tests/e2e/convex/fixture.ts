import {
  paginationOptsValidator,
  paginationResultValidator
} from 'convex/server'
import { ConvexError, v } from 'convex/values'

import { action, mutation, query } from './_generated/server.js'

export const echoAction = action({
  args: {
    value: v.any()
  },
  handler: (_context, args) => args.value,
  returns: v.any()
})

export const throwActionError = action({
  args: {},
  handler: () => {
    throw new Error('E2E action error')
  },
  returns: v.null()
})

export const throwConvexActionError = action({
  args: {},
  handler: () => {
    throw new ConvexError({ code: 'ACTION_FAILED' })
  },
  returns: v.null()
})

export const getValue = query({
  args: {
    key: v.string(),
    runId: v.string()
  },
  handler: async (context, args) => {
    const value = await context.db
      .query('e2eValue')
      .withIndex('by_run_id_and_key', (index) =>
        index.eq('runId', args.runId).eq('key', args.key)
      )
      .unique()

    return value?.value ?? null
  },
  returns: v.any()
})

export const paginateLabels = query({
  args: {
    paginationOpts: paginationOptsValidator,
    prefix: v.string()
  },
  handler: (_context, args) => {
    const start =
      args.paginationOpts.cursor === null
        ? 0
        : Math.trunc(Number(args.paginationOpts.cursor))
    const end = Math.min(start + args.paginationOpts.numItems, 5)

    return {
      continueCursor: String(end),
      isDone: end === 5,
      page: Array.from(
        { length: end - start },
        (_, index) => `${args.prefix}-${start + index + 1}`
      )
    }
  },
  returns: paginationResultValidator(v.string())
})

export const setValue = mutation({
  args: {
    key: v.string(),
    runId: v.string(),
    value: v.any()
  },
  handler: async (context, args) => {
    const existingValue = await context.db
      .query('e2eValue')
      .withIndex('by_run_id_and_key', (index) =>
        index.eq('runId', args.runId).eq('key', args.key)
      )
      .unique()

    if (existingValue === null) {
      await context.db.insert('e2eValue', args)

      return args.value
    }

    await context.db.patch(existingValue._id, { value: args.value })

    return args.value
  },
  returns: v.any()
})

export const removeRun = mutation({
  args: {
    runId: v.string()
  },
  handler: async (context, args) => {
    const values = await context.db
      .query('e2eValue')
      .withIndex('by_run_id_and_key', (index) => index.eq('runId', args.runId))
      .collect()

    await Promise.all(values.map((value) => context.db.delete(value._id)))

    return null
  },
  returns: v.null()
})

export const throwQueryError = query({
  args: {},
  handler: () => {
    throw new Error('E2E query error')
  },
  returns: v.null()
})

export const throwConvexQueryError = query({
  args: {},
  handler: () => {
    throw new ConvexError({ code: 'QUERY_FAILED' })
  },
  returns: v.null()
})

export const throwMutationError = mutation({
  args: {},
  handler: () => {
    throw new Error('E2E mutation error')
  },
  returns: v.null()
})

export const throwConvexMutationError = mutation({
  args: {},
  handler: () => {
    throw new ConvexError({ code: 'MUTATION_FAILED' })
  },
  returns: v.null()
})

export const getIdentity = query({
  args: {},
  handler: async (context) => {
    const identity = await context.auth.getUserIdentity()

    if (identity === null) {
      return null
    }

    return {
      ...(identity.email === undefined ? {} : { email: identity.email }),
      issuer: identity.issuer,
      ...(identity.name === undefined ? {} : { name: identity.name }),
      subject: identity.subject,
      tokenIdentifier: identity.tokenIdentifier
    }
  },
  returns: v.union(
    v.null(),
    v.object({
      email: v.optional(v.string()),
      issuer: v.string(),
      name: v.optional(v.string()),
      subject: v.string(),
      tokenIdentifier: v.string()
    })
  )
})

export const getRequiredIdentity = query({
  args: {},
  handler: async (context) => {
    const identity = await context.auth.getUserIdentity()

    if (identity === null) {
      throw new Error('Authentication required')
    }

    return {
      ...(identity.name === undefined ? {} : { name: identity.name }),
      subject: identity.subject
    }
  },
  returns: v.object({
    name: v.optional(v.string()),
    subject: v.string()
  })
})

export const requireIdentity = mutation({
  args: {},
  handler: async (context) => {
    const identity = await context.auth.getUserIdentity()

    if (identity === null) {
      throw new Error('Authentication required')
    }

    return identity.subject
  },
  returns: v.string()
})
