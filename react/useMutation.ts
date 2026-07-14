import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs
} from 'convex/server'
import { getFunctionName } from 'convex/server'
import type { GenericId, Value } from 'convex/values'
import { useMemo, useRef, useSyncExternalStore } from 'react'

import { MutationController } from '#client/MutationState.js'
import type {
  MutationContext,
  MutationErrorContext,
  MutationErrorSnapshot,
  MutationIdleSnapshot,
  MutationPendingSnapshot,
  MutationSettledContext,
  MutationSnapshot,
  MutationSuccessContext,
  MutationSuccessSnapshot
} from '#client/MutationState.js'
import type {
  OptimisticPaginatedOperations,
  OptimisticQueryValue
} from '#client/Optimistic.js'
import type {
  PaginatedQueryArgs,
  PaginatedQueryItem,
  PaginatedQueryReference
} from '#client/Pagination.js'
import { canonicalConvexValue } from '#client/valueCodec.js'
import { useConvexPulseReactClient } from '#react/ConvexPulseReactContext.js'

/**
 * Creates a typed function for executing a Convex mutation.
 *
 * @param mutation - A generated public mutation reference.
 * @param options - Optimistic update and deduplication behavior.
 * Overlapping calls stay pending until every call settles. The most recently
 * started call controls the final data or error, regardless of completion
 * order. Resetting returns the state to idle and ignores later state updates
 * from calls that were already running.
 *
 * @returns A callable mutation with observable lifecycle state.
 *
 * @public
 */
export function useMutation<Mutation extends FunctionReference<'mutation'>>(
  mutation: Mutation,
  options?: UseMutationOptions<Mutation>
): UseMutationResult<Mutation> {
  const client = useConvexPulseReactClient()
  const mutationRef = useRef(mutation)
  mutationRef.current = mutation
  const optionsRef = useRef(options)
  optionsRef.current = options
  const mutationName = getFunctionName(mutation)
  const controller = useMemo(
    () =>
      new MutationController<
        FunctionArgs<Mutation>,
        FunctionReturnType<Mutation>
      >({
        mutation: (args) => {
          const currentOptions = optionsRef.current
          const dedupeValue = currentOptions?.dedupe?.({ args })
          const dedupeKey =
            dedupeValue === undefined
              ? undefined
              : JSON.stringify(canonicalConvexValue(dedupeValue))
          return client.mutation(
            mutationRef.current,
            args,
            dedupeKey,
            currentOptions?.optimistic,
            currentOptions?.retries
          )
        },
        onError: (context) => optionsRef.current?.onError?.(context),
        onMutate: (context) => optionsRef.current?.onMutate?.(context),
        onSettled: (context) => optionsRef.current?.onSettled?.(context),
        onSuccess: (context) => optionsRef.current?.onSuccess?.(context)
      }),
    [client, mutationName]
  )
  useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  )

  return useMemo(() => {
    function execute(...args: OptionalRestArgs<Mutation>) {
      return controller.execute((args[0] ?? {}) as FunctionArgs<Mutation>)
    }
    return observableMutationResult(execute, controller)
  }, [controller])
}

function observableMutationResult<
  Mutation extends FunctionReference<'mutation'>
>(
  execute: (
    ...args: OptionalRestArgs<Mutation>
  ) => Promise<FunctionReturnType<Mutation>>,
  controller: MutationController<
    FunctionArgs<Mutation>,
    FunctionReturnType<Mutation>
  >
) {
  return Object.defineProperties(execute, {
    data: { get: () => controller.getSnapshot().data },
    error: { get: () => controller.getSnapshot().error },
    isPending: { get: () => controller.getSnapshot().isPending },
    reset: { value: controller.reset },
    status: { get: () => controller.getSnapshot().status }
  }) as UseMutationResult<Mutation>
}

/**
 * A typed callable mutation and its current observable state.
 *
 * @public
 */
export type UseMutationResult<Mutation extends FunctionReference<'mutation'>> =
  MutationExecutor<Mutation> & MutationResult<FunctionReturnType<Mutation>>

/**
 * Options accepted by {@link useMutation}.
 *
 * @public
 */
export type UseMutationOptions<Mutation extends FunctionReference<'mutation'>> =
  Readonly<{
    dedupe?: (context: MutationDedupeContext<Mutation>) => Value
    onError?: (context: MutationErrorContext<FunctionArgs<Mutation>>) => void
    onMutate?: (context: MutationContext<FunctionArgs<Mutation>>) => void
    onSettled?: (
      context: MutationSettledContext<
        FunctionArgs<Mutation>,
        FunctionReturnType<Mutation>
      >
    ) => void
    onSuccess?: (
      context: MutationSuccessContext<
        FunctionArgs<Mutation>,
        FunctionReturnType<Mutation>
      >
    ) => void
    optimistic?: (context: OptimisticMutationContext<Mutation>) => void
    retries?: number
  }>

export type MutationResult<Data> = MutationSnapshot<Data> &
  Readonly<{ reset: () => void }>

export type MutationIdleResult = MutationIdleSnapshot &
  Readonly<{ reset: () => void }>

export type MutationPendingResult = MutationPendingSnapshot &
  Readonly<{ reset: () => void }>

export type MutationErrorResult = MutationErrorSnapshot &
  Readonly<{ reset: () => void }>

export type MutationSuccessResult<Data> = MutationSuccessSnapshot<Data> &
  Readonly<{ reset: () => void }>

/**
 * Values available when computing a mutation deduplication key.
 *
 * @public
 */
export type MutationDedupeContext<
  Mutation extends FunctionReference<'mutation'>
> = Readonly<{
  args: Readonly<FunctionArgs<Mutation>>
}>

/**
 * Values available while applying a mutation's optimistic update.
 *
 * @public
 */
export type OptimisticMutationContext<
  Mutation extends FunctionReference<'mutation'>
> = Readonly<{
  data: Readonly<FunctionArgs<Mutation>>
  optimisticId: OptimisticId
  store: OptimisticStore
}>

/**
 * A temporary identifier that can stand in for an ID from any Convex table.
 *
 * @public
 */
export type OptimisticId = GenericId<never>

/**
 * Access to query results that can be changed optimistically.
 *
 * @public
 */
export type OptimisticStore = Readonly<{
  get: <Query extends FunctionReference<'query'>>(
    query: Query,
    ...args: OptionalRestArgs<Query>
  ) => OptimisticQuery<FunctionReturnType<Query>>
  paginated: <Query extends PaginatedQueryReference>(
    query: Query,
    args: PaginatedQueryArgs<Query>
  ) => OptimisticPaginatedOperations<PaginatedQueryItem<Query>>
}>

/**
 * Optimistic operations available for a query result.
 *
 * @public
 */
export type OptimisticQuery<QueryValue> = OptimisticQueryValue<QueryValue>

type MutationExecutor<Mutation extends FunctionReference<'mutation'>> = (
  ...args: OptionalRestArgs<Mutation>
) => Promise<FunctionReturnType<Mutation>>
