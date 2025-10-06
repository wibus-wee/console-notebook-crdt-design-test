/* eslint-disable @typescript-eslint/no-explicit-any */
/*
CRDT Notebook Schema (v3.4)
---------------------------------
Design focus (this delta):
1) Deprecate NOTEBOOK_ORDER_KEY:
   - Notebook ordering is no longer stored in CRDT (shared state)
   - Each user now maintains a local or person-scope ordering view
   - Org notebooks can optionally maintain shared org-level order via NOTEBOOK_ORDER_ORG_KEY

2) Maintain strict separation of scopes:
   - person-scope: local notebooks, unsynced order, private cache
   - org-scope: shared notebooks, CRDT-synced content only

3) Tombstone GC (Two-phase delete):
   - NB_TOMBSTONES: Y.Map<boolean> (id -> true)
   - NB_TOMBSTONE_META: Y.Map<string,{deletedAt:number, reason?:string}>
   - softDeleteCell(): remove from NB_CELLS + mark tombstone + record deletedAt
   - vacuumNotebook(): local, idempotent GC after TTL (only clears tombstone marks)
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
export const SCHEMA_VERSION = 34 as const // v3.4 (major=3, minor=4)

// Root keys
export const ROOT_MAP_NAME = 'rw-notebook-root'
export const NOTEBOOKS_MAP_KEY = 'notebooks'              // Y.Map<YNotebook>
export const SCHEMA_META_KEY = 'schema-meta'              // Y.Map<{version:number, app?:string}>

// Deprecated order key (v3.4)
export const NOTEBOOK_ORDER_KEY = 'notebook-order'        // ❌ deprecated, use view-layer
export const NOTEBOOK_ORDER_ORG_KEY = 'notebook-order:org'// optional, shared org-level order

// Notebook keys
export const NB_ID = 'id'
export const NB_TITLE = 'title'
export const NB_DATABASE_ID = 'databaseId'
export const NB_TAGS = 'tags'                              // Y.Array<string>
export const NB_METADATA = 'metadata'                      // Y.Map<any>
export const NB_CELLS = 'cells'                            // Y.Array<YCell>
export const NB_TOMBSTONES = 'tombstones'                  // Y.Map<boolean>
export const NB_TOMBSTONE_META = 'tombstone-meta'          // Y.Map<string,{deletedAt:number, reason?:string}>
export const NB_CELL_INDEX_KEY = 'cell-index'              // Y.Map<string, number>

// Cell keys
export const CELL_ID = 'id'
export const CELL_KIND = 'kind'
export const CELL_LANG = 'language'
export const CELL_SOURCE = 'source'
export const CELL_META = 'metadata'

// ExecMeta keys
export const EX_OK = 'ok'
export const EX_STARTED = 'startedAt'
export const EX_ENDED = 'endedAt'
export const EX_DUR = 'durationMs'
export const EX_KERNEL = 'kernel'
export const EX_ERR = 'error'

// ------------------------------
// TypeScript model layer
// ------------------------------
export type CellKind = 'code' | 'markdown' | 'sql' | 'chart' | 'raw'

export interface ExecMeta {
  ok: boolean
  startedAt?: string
  endedAt?: string
  durationMs?: number
  kernel?: string | null
  error?: string | null
}

export interface CellMetadataModel {
  collapsed?: boolean
  executionPolicy?: 'manual' | 'onChange' | 'onStart'
  execHash?: string // queryHash equivalent for outputless execution
  params?: Record<string, unknown>
}

export interface CellModel {
  id: string
  kind: CellKind
  language?: string
  source: string
  metadata: CellMetadataModel
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
  schemaMeta: Y.Map<any>
}

export const ensureNotebookCollections = (doc: Y.Doc): NotebookCollections => {
  const root = doc.getMap(ROOT_MAP_NAME)

  let notebooksMap = root.get(NOTEBOOKS_MAP_KEY) as Y.Map<YNotebook> | undefined
  if (!notebooksMap) {
    notebooksMap = new Y.Map<YNotebook>()
    root.set(NOTEBOOKS_MAP_KEY, notebooksMap)
  }

  let schemaMeta = root.get(SCHEMA_META_KEY) as Y.Map<any> | undefined
  if (!schemaMeta) {
    schemaMeta = new Y.Map<any>()
    root.set(SCHEMA_META_KEY, schemaMeta)
  }

  schemaMeta.set('version', SCHEMA_VERSION)
  return { root, notebooksMap, schemaMeta }
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

  const tomb = new Y.Map<boolean>()
  if (init?.tombstones) for (const k of Object.keys(init.tombstones)) tomb.set(k, true)
  nb.set(NB_TOMBSTONES, tomb)
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
  return c
}

// ------------------------------
// Tombstones & Integrity
// ------------------------------
export const tombstonesMap = (nb: YNotebook): Y.Map<boolean> => {
  let t = nb.get(NB_TOMBSTONES) as Y.Map<boolean> | undefined
  if (!t) { t = new Y.Map<boolean>(); nb.set(NB_TOMBSTONES, t) }
  return t
}
export const tombstoneMetaMap = (nb: YNotebook): Y.Map<any> => {
  let m = nb.get(NB_TOMBSTONE_META) as Y.Map<any> | undefined
  if (!m) { m = new Y.Map<any>(); nb.set(NB_TOMBSTONE_META, m) }
  return m
}

export const softDeleteCell = (nb: YNotebook, cellId: string, reason?: string) => {
  const arr = nb.get(NB_CELLS) as Y.Array<YCell>
  const idx = arr.toArray().findIndex(c => c.get(CELL_ID) === cellId)
  if (idx >= 0) arr.delete(idx, 1)
  const t = tombstonesMap(nb)
  t.set(cellId, true)
  const tm = tombstoneMetaMap(nb)
  const now = Date.now()
  if (now >= WALL_CLOCK_EPOCH_FLOOR_MS) tm.set(cellId, { deletedAt: now, reason })
}

export const vacuumNotebook = (nb: YNotebook, ttlMs = 30 * 24 * 3600 * 1000) => {
  const t = tombstonesMap(nb)
  const tm = tombstoneMetaMap(nb)
  const now = Date.now()
  t.forEach((flag, id) => {
    if (!flag) return
    const meta = tm.get(id) as { deletedAt?: number } | undefined
    const deletedAt = meta?.deletedAt ?? 0
    if (deletedAt === 0) return
    if (now - deletedAt < ttlMs) return
    const arr = nb.get(NB_CELLS) as Y.Array<YCell>
    const stillThere = arr.toArray().some(c => c.get(CELL_ID) === id)
    if (stillThere) return
    t.delete(id)
    tm.delete(id)
  })
}

export const rebuildCellIndex = (nb: YNotebook) => {
  const arr = nb.get(NB_CELLS) as Y.Array<YCell>
  const idxMap = nb.get(NB_CELL_INDEX_KEY) as Y.Map<number>
  idxMap.clear()
  arr.toArray().forEach((c, i) => {
    const cid = c.get(CELL_ID)
    if (cid) idxMap.set(cid, i)
  })
}

// ------------------------------
// Schema View Layer
// ------------------------------
/*
In v3.4, NOTEBOOK_ORDER_KEY is deprecated.
Notebook ordering is now considered a view-layer concern.

Each user may maintain local ordering preferences separately:
- Person-scope: stored in local IndexedDB or user Y.Doc.
- Org-scope: optional NOTEBOOK_ORDER_ORG_KEY for shared org-level order.
*/
