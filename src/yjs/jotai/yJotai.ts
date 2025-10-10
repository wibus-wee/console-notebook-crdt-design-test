import { atom, type WritableAtom } from 'jotai'
import * as Y from 'yjs'
import { isEqual } from "es-toolkit/compat";
/**
 * Thin, typed bridge between Yjs types and Jotai atoms.
 *
 * Design goals:
 * - Minimal abstraction: only subscribe, snapshot(read), and write via native Yjs ops.
 * - Narrow subscriptions by default (type.observe). Opt-in deep observation if needed.
 * - No double updates: do not set after write; rely on Y events to propagate.
 * - Type-safe with minimal unknown usage (decode/encode provide typed boundaries when needed).
 */

/** Equality function used to suppress redundant updates. */
export type Equals<T> = (a: T, b: T) => boolean
const defaultEquals = <T>(a: T, b: T): boolean => isEqual(a, b)

/** Internal util: subscribe to a Y type with optional deep observation. */
function subscribeY<T extends Y.AbstractType<any>, Evt extends Y.YEvent<T>>(
  y: T,
  onChange: (evt: Evt | Evt[]) => void,
  options?: { deep?: boolean }
): () => void {
  const deep = options?.deep === true
  if (deep && 'observeDeep' in (y as unknown as Record<string, unknown>)) {
    const handler = (evts: Evt[], _tr: Y.Transaction) => onChange(evts)
    ;(y as unknown as { observeDeep: (h: (evts: Evt[], tr: Y.Transaction) => void) => void }).observeDeep(handler)
    return () =>
      (y as unknown as { unobserveDeep: (h: (evts: Evt[], tr: Y.Transaction) => void) => void }).unobserveDeep(handler)
  }
  const handler = (evt: Evt, _tr: Y.Transaction) => onChange(evt)
  ;(y as unknown as { observe: (h: (evt: Evt, tr: Y.Transaction) => void) => void }).observe(handler)
  return () =>
    (y as unknown as { unobserve: (h: (evt: Evt, tr: Y.Transaction) => void) => void }).unobserve(handler)
}

/** Run a function inside a Y.Doc transaction when available. */
export function withTransact(doc: Y.Doc | null, fn: () => void): void {
  if (doc) doc.transact(fn)
  else fn()
}

export interface CreateYAtomOptions<YType extends Y.AbstractType<any>, T, Evt extends Y.YEvent<YType> = Y.YEvent<YType>> {
  /** The concrete Yjs type instance (Y.Map, Y.Array, Y.Text, ...). */
  y: YType
  /** Read function to project the Y value into a typed snapshot T. */
  read: (y: YType) => T
  /**
   * Optional write function that applies the next T to the underlying Y type
   * using native Yjs operations. It will be invoked inside a transaction if
   * the Y type is attached to a Y.Doc.
   */
  write?: (y: YType, next: T) => void
  /** Optional equality to suppress redundant sets. Default: Object.is. */
  equals?: Equals<T>
  /**
   * Observe deep changes under this Y type. Default: false (narrower, faster).
   * Use only when read() depends on nested children that won't emit direct events.
   */
  deep?: boolean
  /**
   * Optional filter to ignore unrelated Y events before calling read().
   * This helps narrow updates further (e.g., only when a Map key changes).
   */
  eventFilter?: (evt: Evt) => boolean
}

/**
 * Create a typed Jotai atom bound to a specific Y type.
 * - Subscribes on mount; unsubscribes on unmount.
 * - Suppresses updates via equals.
 * - Writes are wrapped in `withTransact` and rely on Y events to propagate.
 */
export function createYAtom<YType extends Y.AbstractType<any>, T, Evt extends Y.YEvent<YType> = Y.YEvent<YType>>(
  opts: CreateYAtomOptions<YType, T, Evt>
): WritableAtom<T, [T | ((prev: T) => T)], void> {
  const { y, read, write, equals = defaultEquals as Equals<T>, deep, eventFilter } = opts

  // Initialize with a synchronous read to support SSR/hydration and test stability.
  const base = atom<T>(read(y))

  base.onMount = (set) => {
    let prev = read(y)
    // Ensure the latest state is visible immediately on the first mount.
    set(prev)

    const unsubscribe = subscribeY<YType, Evt>(
      y,
      (evt) => {
        // For deep observation, evt can be an array; we skip filtering in that case
        if (!Array.isArray(evt) && eventFilter && !eventFilter(evt as Evt)) return
        const next = read(y)
        if (!equals(prev, next)) {
          prev = next
          set(next)
        }
      },
      { deep }
    )
    return unsubscribe
  }

  // Writer: we do not set(base, ...) here. Y events will drive updates.
  const writer = atom(null, (_get, _set, update: T | ((prev: T) => T)) => {
    if (!write) return
    const current = read(y)
    const next = typeof update === 'function' ? (update as (p: T) => T)(current) : update
    if (equals(current, next)) return
    withTransact(y.doc, () => write(y, next))
  })

  return atom(
    (get) => get(base),
    (_get, set, update) => set(writer, update)
  )
}

// ------------------------ Specialised factories ------------------------

/**
 * Y.Map key atom: subscribes only when `key` is changed. Use decode/encode for type safety.
 */
export function createYMapKeyAtom<TValue, TSnapshot = TValue>(
  map: Y.Map<TValue>,
  key: string,
  opts?: {
    decode?: (v: TValue | undefined) => TSnapshot
    encode?: (v: TSnapshot) => TValue
    equals?: Equals<TSnapshot>
  }
): WritableAtom<TSnapshot, [TSnapshot | ((prev: TSnapshot) => TSnapshot)], void> {
  const decode = opts?.decode ?? ((v: TValue | undefined) => v as unknown as TSnapshot)
  const encode = opts?.encode ?? ((v: TSnapshot) => v as unknown as TValue)
  const equals = (opts?.equals ?? (defaultEquals as Equals<TSnapshot>))

  return createYAtom<Y.Map<TValue>, TSnapshot, Y.YMapEvent<TValue>>({
    y: map,
    read: (m) => decode(m.get(key)),
    write: (m, next) => {
      m.set(key, encode(next))
    },
    equals,
    eventFilter: (evt) => (evt.keysChanged ? evt.keysChanged.has(key) : true),
  })
}

/**
 * Y.Array index atom: exposes a single index snapshot with decode/encode.
 * The eventFilter attempts to be precise using delta, but `equals` still guards safety.
 */
export function createYArrayIndexAtom<TItem, TSnapshot = TItem>(
  arr: Y.Array<TItem>,
  index: number,
  opts?: {
    decode?: (v: TItem | undefined) => TSnapshot
    encode?: (v: TSnapshot) => TItem
    equals?: Equals<TSnapshot>
  }
): WritableAtom<TSnapshot, [TSnapshot | ((prev: TSnapshot) => TSnapshot)], void> {
  const decode = opts?.decode ?? ((v: TItem | undefined) => v as unknown as TSnapshot)
  const encode = opts?.encode ?? ((v: TSnapshot) => v as unknown as TItem)
  const equals = (opts?.equals ?? (defaultEquals as Equals<TSnapshot>))

  return createYAtom<Y.Array<TItem>, TSnapshot, Y.YArrayEvent<TItem>>({
    y: arr,
    read: (a) => decode(a.get(index)),
    write: (a, next) => {
      // Replace at index using native Y ops
      a.delete(index, 1)
      a.insert(index, [encode(next)])
    },
    equals,
    eventFilter: (evt) => {
      const delta = evt.changes?.delta
      if (!Array.isArray(delta)) return true
      let pos = 0
      for (const d of delta) {
        // Types for delta are not exported concretely; we narrow by keys.
        if ('retain' in (d as Record<string, unknown>)) {
          const retain = Number((d as { retain: number }).retain)
          pos += retain
          continue
        }
        if ('insert' in (d as Record<string, unknown>)) {
          const ins = (d as { insert: unknown[] }).insert
          // If insertion occurs at or before the target index, the value at index shifts.
          if (pos <= index) return true
          pos += Array.isArray(ins) ? ins.length : 1
          continue
        }
        if ('delete' in (d as Record<string, unknown>)) {
          // Deletion before or across the target index affects the value at index.
          if (pos <= index) return true
          // pos remains the same after delete in delta semantics
          continue
        }
        // Fallback: be conservative and update.
        return true
      }
      return false
    },
  })
}

/**
 * Y.Text atom: expose the entire string content.
 * For high-frequency editing, consider a diff-based writer for better perf.
 */
export function createYTextAtom(txt: Y.Text): WritableAtom<string, [string | ((prev: string) => string)], void> {
  return createYAtom<Y.Text, string, Y.YTextEvent>({
    y: txt,
    read: (t) => t.toString(),
    write: (t, next) => {
      // Naive replace: delete all, insert new content.
      // This is simple and correct; can be replaced by a diff algorithm if needed.
      const len = t.length
      if (len > 0) t.delete(0, len)
      if (next.length > 0) t.insert(0, next)
    },
    equals: (a, b) => a === b,
  })
}

/**
 * Generic deep path atom (Map/Array traversal). For convenience when you cannot
 * subscribe narrowly. Prefer specialized atoms when possible for performance.
 */
export function createYPathAtom<TSnapshot>(
  root: Y.AbstractType<any>,
  path: Array<string | number>,
  opts?: {
    read: (node: unknown) => TSnapshot
    write?: (parent: unknown, last: string | number, next: TSnapshot) => void
    equals?: Equals<TSnapshot>
    deep?: boolean
  }
): WritableAtom<TSnapshot, [TSnapshot | ((prev: TSnapshot) => TSnapshot)], void> {
  const equals = (opts?.equals ?? (defaultEquals as Equals<TSnapshot>))

  const resolve = (node: unknown, seg: string | number): unknown => {
    if (node instanceof Y.Map) return node.get(String(seg))
    if (node instanceof Y.Array) return node.get(Number(seg))
    return undefined
  }

  const readAtPath = (): TSnapshot => {
    let cur: unknown = root
    for (const seg of path) {
      cur = resolve(cur, seg)
      if (cur === undefined) break
    }
    const projector = opts?.read ?? ((v: unknown) => v as TSnapshot)
    return projector(cur)
  }

  const writeAtPath = (next: TSnapshot): void => {
    const write = opts?.write
    if (write) {
      // Delegate to caller-provided writer for full control
      const parent = path.slice(0, -1).reduce<unknown>((acc, seg) => resolve(acc, seg), root)
      const last = path[path.length - 1]!
      withTransact(root.doc, () => write(parent, last, next))
      return
    }
    // Default writer for common Map/Array endpoints
    const parent = path.slice(0, -1).reduce<unknown>((acc, seg) => resolve(acc, seg), root)
    const last = path[path.length - 1]!
    withTransact(root.doc, () => {
      if (parent instanceof Y.Map) parent.set(String(last), next as unknown)
      else if (parent instanceof Y.Array) {
        const idx = Number(last)
        parent.delete(idx, 1)
        parent.insert(idx, [next as unknown])
      } else {
        throw new Error('Unsupported path parent type for write')
      }
    })
  }

  return createYAtom({
    y: root,
    read: () => readAtPath(),
    write: (_y, next) => writeAtPath(next),
    equals,
    deep: opts?.deep ?? true, // path atom typically needs deep observation
  })
}
