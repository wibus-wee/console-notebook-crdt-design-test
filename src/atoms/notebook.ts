import * as Y from 'yjs'
import { atom } from 'jotai'
import { jotaiStore } from '@/lib/jotai'
import { shouldIgnoreByOrigin } from '@/yjs/bridge/jotai'
import {
  ensureNotebookInDoc,
} from '@/yjs/schema/bootstrap'
import { getOrder, getCellMap } from '@/yjs/schema/access/accessors'
import type { YNotebook, YCell, NotebookModel } from '@/yjs/schema/core/types'
import { insertCell as opInsertCell, moveCell as opMoveCell, removeCell as opRemoveCell } from '@/yjs/schema/ops/mutations'

/**
 * Global Y.Doc holder. Call attachNotebookDoc to initialize.
 */
export const yDocAtom = atom<Y.Doc | null>(null)

/**
 * Current notebook root (Y.Map<any>). Set by attachNotebookDoc.
 */
export const notebookRootAtom = atom<YNotebook | null>(null)

/**
 * Attach a Y.Doc to the Jotai store and ensure notebook root exists.
 * Should be called before any UI consumes notebook atoms.
 */
export const attachNotebookDoc = (doc: Y.Doc, init?: Partial<NotebookModel>) => {
  const root = ensureNotebookInDoc(doc, init)
  jotaiStore.set(yDocAtom, doc)
  jotaiStore.set(notebookRootAtom, root)
  return root
}

/**
 * cellsOrderAtom: subscribes to root.order (Y.Array<string>) and reflects as string[]
 * Write helpers (insert/move/remove) are provided below instead of setting the array directly.
 */
export const cellsOrderAtom = atom<string[]>([])

cellsOrderAtom.onMount = (set) => {
  const nb = jotaiStore.get(notebookRootAtom)
  if (!nb) {
    set([])
    return
  }
  const order = getOrder(nb)
  const sync = () => set(order.toArray())
  const obs = (_evt: any, tx: Y.Transaction) => {
    if (shouldIgnoreByOrigin(tx)) return
    sync()
  }
  sync()
  order.observe(obs)
  return () => order.unobserve(obs)
}

/**
 * Read-only map of id -> YCell existence.
 * This can be used to quickly check if a cell id exists; it subscribes to the cell map keys.
 */
export const cellIdsSetAtom = atom<Set<string>>(new Set<string>())

cellIdsSetAtom.onMount = (set) => {
  const nb = jotaiStore.get(notebookRootAtom)
  if (!nb) {
    set(new Set<string>())
    return
  }
  const map = getCellMap(nb)
  const sync = () => {
    const s = new Set<string>()
    map.forEach((_v, k) => s.add(k as any))
    set(s)
  }
  const obs = (_evt: any, tx: Y.Transaction) => {
    if (shouldIgnoreByOrigin(tx)) return
    sync()
  }
  sync()
  map.observe(obs)
  return () => map.unobserve(obs)
}

/**
 * Write-only atoms for order/index operations, backed by schema ops.
 */
export const insertCellAtom = atom(
  null,
  (_get, _set, payload: { cell: YCell; index?: number }) => {
    const nb = jotaiStore.get(notebookRootAtom)
    if (!nb) return
    opInsertCell(nb, payload.cell, payload.index)
  },
)

export const moveCellAtom = atom(
  null,
  (_get, _set, payload: { id: string; toIndex: number }) => {
    const nb = jotaiStore.get(notebookRootAtom)
    if (!nb) return
    opMoveCell(nb, payload.id, payload.toIndex)
  },
)

export const removeCellAtom = atom(
  null,
  (_get, _set, id: string) => {
    const nb = jotaiStore.get(notebookRootAtom)
    if (!nb) return
    opRemoveCell(nb, id)
  },
)
