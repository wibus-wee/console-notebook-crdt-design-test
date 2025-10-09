import { atom } from 'jotai'
import { jotaiStore } from '@/lib/jotai'
import type { UndoManager } from 'yjs'
import { createNotebookUndoManager } from '@/yjs/schema/quality/undo'
import { notebookRootAtom } from '@/atoms/notebook'

/**
 * Hold a singleton UndoManager for the current notebook root.
 * Call initUndoManager() after attachNotebookDoc.
 */
export const undoManagerAtom = atom<UndoManager | null>(null)

export const initUndoManager = () => {
  const nb = jotaiStore.get(notebookRootAtom)
  if (!nb) return null
  const um = createNotebookUndoManager(nb)
  jotaiStore.set(undoManagerAtom, um)
  return um
}

export const undoStatusAtom = atom<{ canUndo: boolean; canRedo: boolean }>({ canUndo: false, canRedo: false })

undoStatusAtom.onMount = (set) => {
  const um = jotaiStore.get(undoManagerAtom)
  const sync = () => set({ canUndo: !!um && (um as any).undoStack?.length > 0, canRedo: !!um && (um as any).redoStack?.length > 0 })
  if (!um) {
    sync()
    return
  }
  sync()
  const handler = () => sync()
  ;(um as any).on('stack-item-added', handler)
  ;(um as any).on('stack-item-popped', handler)
  ;(um as any).on('stack-cleared', handler)
  return () => {
    ;(um as any).off('stack-item-added', handler)
    ;(um as any).off('stack-item-popped', handler)
    ;(um as any).off('stack-cleared', handler)
  }
}

export const undoAtom = atom(null, (_get, _set) => {
  const um = jotaiStore.get(undoManagerAtom)
  um?.undo()
})

export const redoAtom = atom(null, (_get, _set) => {
  const um = jotaiStore.get(undoManagerAtom)
  um?.redo()
})

