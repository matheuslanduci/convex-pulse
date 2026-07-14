/** Disables a query without requiring placeholder function arguments. */
export const skipToken = 'skip' as const

export type QueryArgs<Args> = Args | typeof skipToken
