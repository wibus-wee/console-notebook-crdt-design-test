import * as Y from 'yjs'
import { createYAtom } from './yJotai'
import { NB_TITLE } from '../schema'

export interface NotebookAtoms {
  titleAtom: ReturnType<typeof createYAtom<Y.Map<any>, string>>
}

export function createNotebookAtoms(nb: Y.Map<any>): NotebookAtoms {
  if (!nb.has(NB_TITLE)) nb.set(NB_TITLE, 'Untitled Notebook')

  const titleAtom = createYAtom<Y.Map<any>, string>({
    y: nb,
    read: (m) => (typeof m.get(NB_TITLE) === 'string' ? m.get(NB_TITLE) : 'Untitled Notebook'),
    write: (m, next) => m.set(NB_TITLE, next),
  })

  return { titleAtom }
}
