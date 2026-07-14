import { useEffect, useRef } from 'react'

import { DataChangeObserver } from '#client/DataChange.js'
import type { DataChangeResult, OnDataChange } from '#client/DataChange.js'

/** Runs a listener after the successful data exposed by useQuery changes. */
export function useOnDataChange<Data>(
  result: DataChangeResult<Data>,
  onDataChange: OnDataChange<Data>
) {
  const observerRef = useRef<DataChangeObserver<Data> | null>(null)
  observerRef.current ??= new DataChangeObserver(onDataChange)
  observerRef.current.setListener(onDataChange)
  const observer = observerRef.current

  useEffect(() => {
    observer.update(result)
  }, [observer, result])
}

export type {
  DataChange,
  DataChangeResult,
  OnDataChange
} from '#client/DataChange.js'
