export class MutationController<Args, Data> {
  readonly execute: (args: Args) => Promise<Data>
  readonly #listeners = new Set<() => void>()
  readonly #options: MutationControllerOptions<Args, Data>
  #activeCalls = new Set<number>()
  #epoch = 0
  #latestCall = 0
  #latestOutcome: MutationOutcome<Data> | undefined
  #snapshot: MutationSnapshot<Data> = idleMutationSnapshot()

  constructor(options: MutationControllerOptions<Args, Data>) {
    this.#options = options
    this.execute = (args) => this.#execute(args)
  }

  getSnapshot = () => this.#snapshot

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  reset = () => {
    this.#epoch += 1
    this.#activeCalls = new Set()
    this.#latestOutcome = undefined
    this.#setSnapshot(idleMutationSnapshot())
  }

  #execute(args: Args) {
    this.#latestCall += 1
    const call = this.#latestCall
    const epoch = this.#epoch
    this.#activeCalls.add(call)
    this.#latestOutcome = undefined
    this.#setSnapshot(pendingMutationSnapshot())

    let promise: Promise<Data>
    try {
      this.#options.onMutate?.({ args })
      promise = this.#options.mutation(args)
    } catch (error) {
      promise = Promise.reject(error)
    }

    return promise.then(
      (data) => {
        this.#settle(call, epoch, { data, status: 'success' })
        this.#options.onSuccess?.({ args, data })
        this.#options.onSettled?.({ args, data, error: null })
        return data
      },
      (error: unknown) => {
        const normalizedError = mutationError(error)
        this.#settle(call, epoch, {
          error: normalizedError,
          status: 'error'
        })
        this.#options.onError?.({ args, error: normalizedError })
        this.#options.onSettled?.({
          args,
          data: undefined,
          error: normalizedError
        })
        throw error
      }
    )
  }

  #settle(call: number, epoch: number, outcome: MutationOutcome<Data>) {
    if (epoch !== this.#epoch) {
      return
    }
    this.#activeCalls.delete(call)
    if (call === this.#latestCall) {
      this.#latestOutcome = outcome
    }
    if (this.#activeCalls.size > 0 || this.#latestOutcome === undefined) {
      return
    }

    this.#setSnapshot(
      this.#latestOutcome.status === 'success'
        ? successMutationSnapshot(this.#latestOutcome.data)
        : errorMutationSnapshot(this.#latestOutcome.error)
    )
  }

  #setSnapshot(snapshot: MutationSnapshot<Data>) {
    this.#snapshot = snapshot
    for (const listener of this.#listeners) {
      listener()
    }
  }
}

export function idleMutationSnapshot(): MutationIdleSnapshot {
  return { data: undefined, error: null, isPending: false, status: 'idle' }
}

function pendingMutationSnapshot(): MutationPendingSnapshot {
  return { data: undefined, error: null, isPending: true, status: 'pending' }
}

function successMutationSnapshot<Data>(
  data: Data
): MutationSuccessSnapshot<Data> {
  return { data, error: null, isPending: false, status: 'success' }
}

function errorMutationSnapshot(error: Error): MutationErrorSnapshot {
  return { data: undefined, error, isPending: false, status: 'error' }
}

function mutationError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}

export type MutationControllerOptions<Args, Data> = Readonly<{
  mutation: (args: Args) => Promise<Data>
  onError?: (context: MutationErrorContext<Args>) => void
  onMutate?: (context: MutationContext<Args>) => void
  onSettled?: (context: MutationSettledContext<Args, Data>) => void
  onSuccess?: (context: MutationSuccessContext<Args, Data>) => void
}>

export type MutationSnapshot<Data> =
  | MutationIdleSnapshot
  | MutationPendingSnapshot
  | MutationErrorSnapshot
  | MutationSuccessSnapshot<Data>

export type MutationIdleSnapshot = Readonly<{
  data: undefined
  error: null
  isPending: false
  status: 'idle'
}>

export type MutationPendingSnapshot = Readonly<{
  data: undefined
  error: null
  isPending: true
  status: 'pending'
}>

export type MutationErrorSnapshot = Readonly<{
  data: undefined
  error: Error
  isPending: false
  status: 'error'
}>

export type MutationSuccessSnapshot<Data> = Readonly<{
  data: Data
  error: null
  isPending: false
  status: 'success'
}>

export type MutationContext<Args> = Readonly<{ args: Readonly<Args> }>

export type MutationSuccessContext<Args, Data> = Readonly<{
  args: Readonly<Args>
  data: Data
}>

export type MutationErrorContext<Args> = Readonly<{
  args: Readonly<Args>
  error: Error
}>

export type MutationSettledContext<Args, Data> = Readonly<{
  args: Readonly<Args>
  data: Data | undefined
  error: Error | null
}>

type MutationOutcome<Data> =
  | Readonly<{ data: Data; status: 'success' }>
  | Readonly<{ error: Error; status: 'error' }>
