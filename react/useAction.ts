import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType
} from 'convex/server'
import { getFunctionName } from 'convex/server'
import { useMemo, useRef, useSyncExternalStore } from 'react'

import { createActionExecutor } from '#client/ActionState.js'
import type {
  FrameworkActionOptions,
  FrameworkActionResult
} from '#client/ActionState.js'
import { MutationController } from '#client/MutationState.js'
import { useConvexPulseReactClient } from '#react/ConvexPulseReactContext.js'

/** Creates a typed function for executing a Convex action. */
export function useAction<Action extends FunctionReference<'action'>>(
  action: Action,
  options?: UseActionOptions<Action>
): UseActionResult<Action> {
  const client = useConvexPulseReactClient()
  const actionRef = useRef(action)
  actionRef.current = action
  const optionsRef = useRef(options)
  optionsRef.current = options
  const actionName = getFunctionName(action)
  const controller = useMemo(
    () =>
      new MutationController<FunctionArgs<Action>, FunctionReturnType<Action>>({
        mutation: (args) =>
          client.action(
            actionRef.current,
            args,
            optionsRef.current?.retries,
            optionsRef.current?.dedupe?.({ args })
          ),
        onError: (context) => optionsRef.current?.onError?.(context),
        onMutate: (context) => optionsRef.current?.onMutate?.(context),
        onSettled: (context) => optionsRef.current?.onSettled?.(context),
        onSuccess: (context) => optionsRef.current?.onSuccess?.(context)
      }),
    [actionName, client]
  )
  useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  )

  return useMemo(
    () => observableActionResult(createActionExecutor(controller), controller),
    [controller]
  )
}

function observableActionResult<Action extends FunctionReference<'action'>>(
  execute: (
    ...args: Parameters<UseActionResult<Action>>
  ) => Promise<FunctionReturnType<Action>>,
  controller: MutationController<
    FunctionArgs<Action>,
    FunctionReturnType<Action>
  >
) {
  return Object.defineProperties(execute, {
    data: { get: () => controller.getSnapshot().data },
    error: { get: () => controller.getSnapshot().error },
    isPending: { get: () => controller.getSnapshot().isPending },
    reset: { value: controller.reset },
    status: { get: () => controller.getSnapshot().status }
  }) as UseActionResult<Action>
}

export type UseActionOptions<Action extends FunctionReference<'action'>> =
  FrameworkActionOptions<Action>

export type UseActionResult<Action extends FunctionReference<'action'>> =
  FrameworkActionResult<Action>

export type {
  ActionDedupeContext,
  ActionErrorResult,
  ActionIdleResult,
  ActionPendingResult,
  ActionResult,
  ActionSuccessResult
} from '#client/ActionState.js'
