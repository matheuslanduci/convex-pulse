export function validateRetries(retries = 0) {
  if (!Number.isSafeInteger(retries) || retries < 0) {
    throw new RangeError('retries must be a non-negative safe integer')
  }
  return retries
}

export async function withRetries<Value>(
  operation: () => Promise<Value>,
  retries: number | undefined
) {
  const remaining = validateRetries(retries)
  try {
    return await operation()
  } catch (error) {
    if (remaining === 0) {
      throw error
    }
    return withRetries(operation, remaining - 1)
  }
}
