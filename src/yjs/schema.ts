/* eslint-disable @typescript-eslint/no-explicit-any */
/*
CRDT Notebook Schema (v3.3)
---------------------------------
Design focus (this delta):
1) Outputless Execution Model:
   - Removed outputs/attachments and all DataRef-related keys.
   - Added CELL_EXEC: Y.Map<ExecMetaV33> for minimal execution metadata.
   - No result or blob synchronization; all outputs are replayable.

2) Retained v3.2 Core Improvements:
   - Global SSOT for version (root.schema-meta.version).
   - Derived fast cell index (NB_CELL_INDEX_KEY).
   - Two-phase tombstone deletion (NB_TOMBSTONES + NB_TOMBSTONE_META).

Philosophy:
- CRDT only persists collaborative truth and replay anchors (logic, metadata, exec meta).
- Do not persist transient or derived runtime state (outputs, blobs, charts, etc.).
---------------------------------
*/

import * as Y from 'yjs'

// ------------------------------
// Utils
// ------------------------------
const ulid = () => {
  const now = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  return `${now}${rand}`.padEnd(26, '0').slice(0, 26)
}

export const WALL_CLOCK_EPOCH_FLOOR_MS = Date.UTC(2001, 0, 1)

// ------------------------------
// Versions & Constants
// ------------------------------
export const SCHEMA_VERSION = 33 as const // v3.3 (major=3, minor=3)

// Root keys
export const ROOT_MAP_NAME = 'rw-notebook-root'
export const NOTEBOOKS_MAP_KEY = 'notebooks'
export const NOTEBOOK_ORDER_KEY = 'notebook-order'
export const SCHEMA_META_KEY = 'schema-meta'

// Notebook keys
export const NB_ID = 'id'
export const NB_TITLE = 'title'
export const NB_DATABASE_ID = 'databaseId'
export const NB_TAGS = 'tags'
export const NB_METADATA = 'metadata'
export const NB_CELLS = 'cells'
export const NB_TOMBSTONES = 'tombstones'
export const NB_TOMBSTONE_META = 'tombstone-meta'
export const NB_CELL_INDEX_KEY = 'cell-index'

// Cell keys
export const CELL_ID = 'id'
export const CELL_KIND = 'kind'                            // 'code' | 'markdown' | 'sql' | 'chart' | 'raw'
export const CELL_LANG = 'language'                        // optional
export const CELL_SOURCE = 'source'                        // Y.Text
export const CELL_META = 'metadata'                        // Y.Map<any>
export const CELL_EXEC = 'exec'                            // Y.Map<ExecMeta>

// ExecMeta keys
export const EX_STATUS = 'status' // 'idle' | 'running' | 'success' | 'error' | 'cancelled'
export const EX_BY = 'executedBy' // userId
export const EX_STARTED = 'startedAt'
export const EX_ENDED = 'endedAt'
export const EX_DUR = 'durationMs'
export const EX_QHASH = 'queryHash' // queryHash → result
export const EX_ERR = 'error'

// ------------------------------
// TypeScript model layer
// ------------------------------
export type CellKind = 'code' | 'markdown' | 'sql' | 'chart' | 'raw'
export type ExecState = 'idle' | 'running' | 'success' | 'error' | 'cancelled'

export interface ExecMeta {
  status: ExecState
  executedBy?: string
  startedAt?: string
  endedAt?: string
  durationMs?: number
  queryHash?: string
  error?: string
}

export interface CellMetadataModel {
  collapsed?: boolean
  executionPolicy?: 'manual' | 'onChange' | 'onStart'
  params?: Record<string, unknown>
}

export interface CellModel {
  id: string
  kind: CellKind
  language?: string
  source: string
  metadata: CellMetadataModel
  exec?: ExecMeta
}

export interface NotebookMetadataModel {
  appVersion?: string
  notebookType?: 'sql' | 'md' | 'python' | string
}

export interface NotebookModel {
  id: string
  title: string
  databaseId: string | null
  tags: string[]
  metadata: NotebookMetadataModel
  cells: CellModel[]
  tombstones: Record<string, true>
}

// ------------------------------
// Root handles
// ------------------------------
export type YNotebook = Y.Map<any>
export type YCell = Y.Map<any>

export interface NotebookCollections {
  root: Y.Map<any>
  notebooksMap: Y.Map<YNotebook>
  notebookOrder: Y.Array<string>
  schemaMeta: Y.Map<any>
}

export const ensureNotebookCollections = (doc: Y.Doc): NotebookCollections => {
  const root = doc.getMap(ROOT_MAP_NAME)

  let notebooksMap = root.get(NOTEBOOKS_MAP_KEY) as Y.Map<YNotebook> | undefined
  if (!notebooksMap) {
    notebooksMap = new Y.Map<YNotebook>()
    root.set(NOTEBOOKS_MAP_KEY, notebooksMap)
  }

  let notebookOrder = root.get(NOTEBOOK_ORDER_KEY) as Y.Array<string> | undefined
  if (!notebookOrder) {
    notebookOrder = new Y.Array<string>()
    root.set(NOTEBOOK_ORDER_KEY, notebookOrder)
  }

  let schemaMeta = root.get(SCHEMA_META_KEY) as Y.Map<any> | undefined
  if (!schemaMeta) {
    schemaMeta = new Y.Map<any>()
    root.set(SCHEMA_META_KEY, schemaMeta)
  }
  schemaMeta.set('version', SCHEMA_VERSION)

  return { root, notebooksMap, notebookOrder, schemaMeta }
}

// ------------------------------
// Creation helpers
// ------------------------------
export const createDefaultNotebookMetadata = (): NotebookMetadataModel => ({ appVersion: undefined })

export const createNotebook = (init?: Partial<NotebookModel>): YNotebook => {
  const nb = new Y.Map<any>()
  nb.set(NB_ID, init?.id ?? ulid())
  nb.set(NB_TITLE, init?.title ?? 'Untitled Notebook')
  nb.set(NB_DATABASE_ID, init?.databaseId ?? null)

  const tags = new Y.Array<string>()
  ;(init?.tags ?? []).forEach(t => tags.push([t]))
  nb.set(NB_TAGS, tags)

  const meta = new Y.Map<any>()
  const metaVal = { ...createDefaultNotebookMetadata(), ...(init?.metadata ?? {}) }
  for (const [k, v] of Object.entries(metaVal)) meta.set(k, v)
  nb.set(NB_METADATA, meta)

  const cells = new Y.Array<YCell>()
  ;(init?.cells ?? []).forEach(c => cells.push([createCell(c)]))
  nb.set(NB_CELLS, cells)

  nb.set(NB_TOMBSTONES, new Y.Map<boolean>())
  nb.set(NB_TOMBSTONE_META, new Y.Map<any>())
  nb.set(NB_CELL_INDEX_KEY, new Y.Map<number>())
  rebuildCellIndex(nb)
  return nb
}

export const createCell = (init?: Partial<CellModel> & { kind: CellKind }): YCell => {
  if (!init?.kind) throw new Error('Cell kind required')
  const c = new Y.Map<any>()
  c.set(CELL_ID, init.id ?? ulid())
  c.set(CELL_KIND, init.kind)
  if (init.language) c.set(CELL_LANG, init.language)

  const text = new Y.Text()
  text.insert(0, init?.source ?? '')
  c.set(CELL_SOURCE, text)

  const m = new Y.Map<any>()
  const mval: CellMetadataModel = { collapsed: false, executionPolicy: 'manual', ...(init?.metadata ?? {}) }
  for (const [k, v] of Object.entries(mval)) m.set(k, v)
  c.set(CELL_META, m)

  if (init.exec) {
    const e = new Y.Map<any>()
    e.set(EX_STATUS, init.exec.status)
    if (init.exec.executedBy) e.set(EX_BY, init.exec.executedBy)
    if (init.exec.startedAt) e.set(EX_STARTED, init.exec.startedAt)
    if (init.exec.endedAt) e.set(EX_ENDED, init.exec.endedAt)
    if (init.exec.durationMs != null) e.set(EX_DUR, init.exec.durationMs)
    if (init.exec.queryHash) e.set(EX_QHASH, init.exec.queryHash)
    if (init.exec.error) e.set(EX_ERR, init.exec.error)
    c.set(CELL_EXEC, e)
  }
  return c
}

// ------------------------------
// Access helpers
// ------------------------------
export const getNotebook = (doc: Y.Doc, id: string): YNotebook | undefined => {
  const { notebooksMap } = ensureNotebookCollections(doc)
  return notebooksMap.get(id)
}

export const getCellsArray = (nb: YNotebook): Y.Array<YCell> => {
  let a = nb.get(NB_CELLS) as Y.Array<YCell> | undefined
  if (!a) { a = new Y.Array<YCell>(); nb.set(NB_CELLS, a) }
  return a
}

export const getCellIndexMap = (nb: YNotebook): Y.Map<number> => {
  let m = nb.get(NB_CELL_INDEX_KEY) as Y.Map<number> | undefined
  if (!m) { m = new Y.Map<number>(); nb.set(NB_CELL_INDEX_KEY, m) }
  return m
}

export const rebuildCellIndex = (nb: YNotebook) => {
  const idx = getCellIndexMap(nb)
  const cells = nb.get(NB_CELLS) as Y.Array<YCell> | undefined
  idx.clear()
  cells?.toArray().forEach((c, i) => idx.set(c.get(CELL_ID), i))
}

// ------------------------------
// Example bootstrap
// ------------------------------
export const bootstrapDoc = (doc: Y.Doc, init?: Partial<NotebookModel>) => {
  const { notebooksMap, notebookOrder, schemaMeta } = ensureNotebookCollections(doc)
  schemaMeta.set('version', SCHEMA_VERSION)

  const nb = createNotebook(init)
  const id = nb.get(NB_ID) as string
  notebooksMap.set(id, nb)
  notebookOrder.push([id])
  return nb
}
