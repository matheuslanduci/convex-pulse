import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  OptionalRestArgs
} from 'convex/server'
import type { Value } from 'convex/values'

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

export function createActionController<
  Action extends FunctionReference<'action'>
>(
  action: (
    args: FunctionArgs<Action>,
    retries?: number,
    dedupeValue?: Value
  ) => Promise<FunctionReturnType<Action>>,
  options?: FrameworkActionOptions<Action>
) {
  return new MutationController<
    FunctionArgs<Action>,
    FunctionReturnType<Action>
  >({
    mutation: (args) =>
      action(args, options?.retries, options?.dedupe?.({ args })),
    onError: (context) => options?.onError?.(context),
    onMutate: (context) => options?.onMutate?.(context),
    onSettled: (context) => options?.onSettled?.(context),
    onSuccess: (context) => options?.onSuccess?.(context)
  })
}

export function createActionExecutor<
  Action extends FunctionReference<'action'>
>(
  controller: MutationController<
    FunctionArgs<Action>,
    FunctionReturnType<Action>
  >
) {
  return function execute(...args: OptionalRestArgs<Action>) {
    return controller.execute((args[0] ?? {}) as FunctionArgs<Action>)
  }
}

export type FrameworkActionOptions<Action extends FunctionReference<'action'>> =
  Readonly<{
    dedupe?: (context: ActionDedupeContext<Action>) => Value
    onError?: (context: MutationErrorContext<FunctionArgs<Action>>) => void
    onMutate?: (context: MutationContext<FunctionArgs<Action>>) => void
    onSettled?: (
      context: MutationSettledContext<
        FunctionArgs<Action>,
        FunctionReturnType<Action>
      >
    ) => void
    onSuccess?: (
      context: MutationSuccessContext<
        FunctionArgs<Action>,
        FunctionReturnType<Action>
      >
    ) => void
    retries?: number
  }>

export type ActionDedupeContext<Action extends FunctionReference<'action'>> =
  Readonly<{
    args: Readonly<FunctionArgs<Action>>
  }>

export type FrameworkActionResult<Action extends FunctionReference<'action'>> =
  ActionExecutor<Action> & ActionResult<FunctionReturnType<Action>>

export type ActionExecutor<Action extends FunctionReference<'action'>> = (
  ...args: OptionalRestArgs<Action>
) => Promise<FunctionReturnType<Action>>

export type ActionResult<Data> = MutationSnapshot<Data> &
  Readonly<{ reset: () => void }>

export type ActionIdleResult = MutationIdleSnapshot &
  Readonly<{ reset: () => void }>

export type ActionPendingResult = MutationPendingSnapshot &
  Readonly<{ reset: () => void }>

export type ActionErrorResult = MutationErrorSnapshot &
  Readonly<{ reset: () => void }>

export type ActionSuccessResult<Data> = MutationSuccessSnapshot<Data> &
  Readonly<{ reset: () => void }>
