import * as Y from 'yjs'
import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import { jotaiStore } from '@/lib/jotai'
import { shouldIgnoreByOrigin, withUserAction } from '@/yjs/bridge/jotai'
import { notebookRootAtom } from '@/atoms/notebook'
import { getCell } from '@/yjs/schema/access/accessors'
import { CELL_LANG, CELL_META, CELL_SOURCE } from '@/yjs/schema/core/keys'
import type { CellMetadataModel } from '@/yjs/schema/core/types'

/**
 * This module bridges Yjs cell structures to Jotai atoms.
 *
 * Pattern used across atoms:
 * - onMount: subscribe Yjs (observe) → sync snapshot into a Jotai base atom
 * - read: return latest snapshot from the base atom
 * - write: perform Yjs mutations inside withUserAction to tag origin and avoid echo loops
 * - filter: ignore transactions with shouldIgnoreByOrigin to prevent redundant updates
 */


/**
 * Resolve a cell's Y.Map from the current notebook in jotaiStore.
 * Returns undefined when notebook is not ready or cell does not exist.
 */
const getCellFromEnv = (id: string): Y.Map<any> | undefined => {
  const nb = jotaiStore.get(notebookRootAtom)
  if (!nb) return undefined
  return getCell(nb, id)
}

/**
 * Resolve the metadata Y.Map of a cell (stored under CELL_META).
 * Performs a runtime type guard to ensure it's a Y.Map before returning.
 */
const getCellMetaMap = (id: string): Y.Map<any> | undefined => {
  const c = getCellFromEnv(id)
  const m = c?.get(CELL_META)
  return m instanceof Y.Map ? (m as Y.Map<any>) : undefined
}

/**
 * Resolve the source Y.Text of a cell (stored under CELL_SOURCE).
 * Performs a runtime type guard to ensure it's a Y.Text before returning.
 */
const getCellText = (id: string): Y.Text | undefined => {
  const c = getCellFromEnv(id)
  const t = c?.get(CELL_SOURCE)
  return t instanceof Y.Text ? (t as Y.Text) : undefined
}


/**
 * Cell metadata as a structured model.
 * - Bridges the cell's metadata Y.Map into a typed Jotai atom.
 * - Subscribes to Yjs changes and filters by transaction origin.
 * - Writes are wrapped in withUserAction to mark local user intent.
 *
 * Extend the mapping in sync()/write sections when adding fields to CellMetadataModel.
 */
export const cellMetadataAtom = atomFamily((id: string) => {
  const base = atom<CellMetadataModel | undefined>(undefined)

  base.onMount = (set) => {
    const m = getCellMetaMap(id)
    if (!m) {
      set(undefined)
      return
    }
    // Pull current Yjs state into a typed snapshot for Jotai.
    const sync = () => {
      const next: CellMetadataModel = {
        backgroundDDL: (m.get('backgroundDDL') as boolean | undefined) ?? false,
      }
      set(next)
    }
    const obs = (_evt: any, tx: Y.Transaction) => {
      // Avoid echo updates triggered by our own withUserAction writes (or other ignored origins).
      if (shouldIgnoreByOrigin(tx)) return
      sync()
    }
    sync()
    m.observe(obs)
    return () => m.unobserve(obs)
  }

  return atom(
    (get) => get(base),
    (_get, _set, updater: Partial<CellMetadataModel> | ((prev: CellMetadataModel) => CellMetadataModel)) => {
      const m = getCellMetaMap(id)
      if (!m) return
      // Compose previous snapshot to support partial/functional updates from callers.
      const prev: CellMetadataModel = {
        backgroundDDL: (m.get('backgroundDDL') as boolean | undefined) ?? false,
      }
      const next = typeof updater === 'function' ? (updater as any)(prev) : { ...prev, ...updater }
      const doc = m.doc as Y.Doc | undefined
      // Mutate Yjs inside a user-tagged transaction to enable origin filtering in observers.
      withUserAction(doc, () => {
        if (next.backgroundDDL !== undefined) m.set('backgroundDDL', next.backgroundDDL)
      })
    },
  )
})

// -------- Language (scalar on YCell map) --------
/**
 * Cell language as an optional scalar (string) stored directly on the cell Y.Map.
 * - Reads from/updates the CELL_LANG key.
 * - Deleting the key represents an undefined language.
 */
export const cellLanguageAtom = atomFamily((id: string) => {
  const base = atom<string | undefined>(undefined)

  base.onMount = (set) => {
    const c = getCellFromEnv(id)
    if (!c) {
      set(undefined)
      return
    }
    // Keep local atom in sync with the Y.Map scalar value.
    const sync = () => set((c.get(CELL_LANG) as string | undefined) ?? undefined)
    const obs = (_evt: any, tx: Y.Transaction) => {
      if (shouldIgnoreByOrigin(tx)) return
      sync()
    }
    sync()
    c.observe(obs)
    return () => c.unobserve(obs)
  }

  return atom(
    (get) => get(base),
    (_get, _set, next: string | undefined) => {
      const c = getCellFromEnv(id)
      if (!c) return
      const doc = c.doc as Y.Doc | undefined
      // Update the scalar; delete the key when undefined for a clean Y.Map.
      withUserAction(doc, () => {
        if (next === undefined) {
          c.delete(CELL_LANG)
        } else {
          c.set(CELL_LANG, next)
        }
      })
    },
  )
})

// -------- Content (Y.Text) --------
/**
 * Cell content (string snapshot) — READ-ONLY.
 * - Mirrors the Y.Text value into a string atom for UI that only needs to display/read.
 * - Do NOT bind editors to this atom for writing; use `cellTextAtom` and Monaco's yjs binding instead.
 */
export const cellContentAtom = atomFamily((id: string) => {
  const base = atom<string>('')

  base.onMount = (set) => {
    const t = getCellText(id)
    if (!t) {
      set('')
      return
    }
    // Sync local snapshot from Y.Text; observe changes and filter by origin.
    const sync = () => set(t.toString())
    const obs = (_evt: any, tx: Y.Transaction) => {
      if (shouldIgnoreByOrigin(tx)) return
      sync()
    }
    sync()
    t.observe(obs)
    return () => t.unobserve(obs)
  }

  // Expose as read-only atom; edits should go through Monaco-Yjs binding on the Y.Text handle.
  return atom((get) => get(base))
})

/**
 * Cell Y.Text handle — for Monaco binding.
 * - Provides the stable Y.Text reference for the given cell id.
 * - Observes the parent cell map to refresh the handle if CELL_SOURCE is replaced.
 * - No setter: mutations should come from the editor binding (e.g., y-monaco).
 */
export const cellTextAtom = atomFamily((id: string) => {
  const base = atom<Y.Text | undefined>(undefined)

  base.onMount = (set) => {
    const c = getCellFromEnv(id)
    if (!c) {
      set(undefined)
      return
    }
    const sync = () => set(getCellText(id))
    const obs = (_evt: any, tx: Y.Transaction) => {
      if (shouldIgnoreByOrigin(tx)) return
      // Only updates when CELL_SOURCE ref changes (not on text edits).
      sync()
    }
    sync()
    c.observe(obs)
    return () => c.unobserve(obs)
  }

  return atom((get) => get(base))
})
