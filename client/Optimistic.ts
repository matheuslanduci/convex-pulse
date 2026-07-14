export type OptimisticQueryValue<QueryValue> =
  QueryValue extends readonly unknown[]
    ? OptimisticArrayOperations<ArrayElement<QueryValue>>
    : QueryValue extends Readonly<Record<string, unknown>>
      ? Readonly<{ merge: (value: Partial<QueryValue>) => void }>
      : Readonly<{ modify: (value: QueryValue) => void }>

/**
 * Optimistic array operations. Keyed operations use an element's `_id` by
 * default, or the element itself for primitives. Pass `keyBy` for other keys.
 */
export type OptimisticArrayOperations<Element> = Readonly<{
  /** Adds an element to the end of the collection. */
  append: (value: Element) => void
  /** Adds an element before or after the element matching a stable key. */
  insert: <Key>(
    value: Element,
    position: OptimisticInsertPosition<Element, Key>
  ) => void
  /** Adds an element to the beginning of the collection. */
  prepend: (value: Element) => void
  /** Removes the element matching a stable key. */
  remove: <Key>(key: Key, keyBy?: OptimisticKeySelector<Element, Key>) => void
  /** Replaces the element matching a stable key. */
  replace: <Key>(
    key: Key,
    value: Element,
    keyBy?: OptimisticKeySelector<Element, Key>
  ) => void
  /** Shallow-merges an object element, or replaces a primitive element. */
  update: <Key>(
    key: Key,
    value: Element extends Readonly<Record<string, unknown>>
      ? Partial<Element>
      : Element,
    keyBy?: OptimisticKeySelector<Element, Key>
  ) => void
  /** Replaces an element with the same key, or appends it when absent. */
  upsert: <Key>(
    value: Element,
    keyBy?: OptimisticKeySelector<Element, Key>
  ) => void
}>

export type OptimisticInsertPosition<Element, Key> =
  | Readonly<{
      after: Key
      before?: never
      keyBy?: OptimisticKeySelector<Element, Key>
    }>
  | Readonly<{
      after?: never
      before: Key
      keyBy?: OptimisticKeySelector<Element, Key>
    }>

export type OptimisticKeySelector<Element, Key> = (value: Element) => Key

export type OptimisticPaginatedOperations<Element> = Readonly<{
  /** Adds an element after the final loaded page only when the list is complete. */
  appendIfLoaded: (value: Element) => void
  /** Adds an element to the beginning of the first loaded page. */
  prepend: (value: Element) => void
  /** Removes a matching element from every loaded page. */
  remove: <Key>(key: Key, keyBy?: OptimisticKeySelector<Element, Key>) => void
  /** Replaces a matching element in every loaded page. */
  replace: <Key>(
    key: Key,
    value: Element,
    keyBy?: OptimisticKeySelector<Element, Key>
  ) => void
  /** Updates a matching element in every loaded page. */
  update: <Key>(
    key: Key,
    value: Element extends Readonly<Record<string, unknown>>
      ? Partial<Element>
      : Element,
    keyBy?: OptimisticKeySelector<Element, Key>
  ) => void
}>

type ArrayElement<QueryValue> = QueryValue extends readonly (infer Element)[]
  ? Element
  : never
