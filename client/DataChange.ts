const noPreviousData = Symbol('no previous query data')

export class DataChangeObserver<Data> {
  #listener: OnDataChange<Data>
  #previousData: Data | typeof noPreviousData = noPreviousData

  constructor(listener: OnDataChange<Data>) {
    this.#listener = listener
  }

  setListener(listener: OnDataChange<Data>) {
    this.#listener = listener
  }

  update(result: DataChangeResult<Data>) {
    if (result.status !== 'success') {
      return
    }

    const previous = this.#previousData
    this.#previousData = result.data
    if (previous === noPreviousData || Object.is(previous, result.data)) {
      return
    }

    this.#listener({ next: result.data, previous })
  }
}

export type DataChange<Data> = Readonly<{
  next: Data
  previous: Data
}>

export type OnDataChange<Data> = (change: DataChange<Data>) => void

export type DataChangeResult<Data> =
  | Readonly<{ data: Data; status: 'success' }>
  | Readonly<{
      data: undefined
      status: 'disabled' | 'error' | 'pending'
    }>
