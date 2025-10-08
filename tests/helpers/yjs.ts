import * as Y from 'yjs'
import { ensureNotebookInDoc } from '../../src/yjs/schema/bootstrap'
import { getCellMap, getOrder } from '../../src/yjs/schema/access/accessors'
import { tombstonesMap, tombstoneMetaMap } from '../../src/yjs/schema/access/tombstone'
import { createCell } from '../../src/yjs/schema/access/cells'
import type { NotebookModel, YNotebook, YCell } from '../../src/yjs/schema/core/types'

export const newDoc = () => new Y.Doc()

export const setupNotebook = (init?: Partial<NotebookModel>) => {
  const doc = newDoc()
  const nb = ensureNotebookInDoc(doc, init)
  return { doc, nb }
}

export const cellMap = (nb: YNotebook) => getCellMap(nb)
export const order = (nb: YNotebook) => getOrder(nb)
export const tomb = (nb: YNotebook) => tombstonesMap(nb as any)
export const tombMeta = (nb: YNotebook) => tombstoneMetaMap(nb as any)

export const makeCell = (init: Partial<YCell> & { kind: any }) => createCell(init as any)

