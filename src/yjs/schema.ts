/* eslint-disable @typescript-eslint/no-explicit-any */
/*
CRDT Notebook Schema (v3.2)
---------------------------------
Design focus (this delta):
1) Version SSOT:
   - Global: root.schema-meta.version = SCHEMA_VERSION (authority)
   - Notebook metadata no longer stores schemaVersion (removed by migration)

2) Fast Cell Index (Derived, CRDT-safe):
   - NB_CELL_INDEX_KEY: Y.Map<string, number> (cellId -> index)
   - Rebuild + incremental maintenance helpers
   - Always treat NB_CELLS (Y.Array) as source of truth

3) Tombstone GC (Two-phase delete):
   - NB_TOMBSTONES: Y.Map<boolean> (id -> true)  [unchanged]
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

// conservative floor to avoid monotonic-clock confusion on restarts
export const WALL_CLOCK_EPOCH_FLOOR_MS = Date.UTC(2001, 0, 1)

// ------------------------------
// Versions & Constants
// ------------------------------
export const SCHEMA_VERSION = 32 as const // v3.2 (major=3, minor=2)

// Root keys
export const ROOT_MAP_NAME = 'rw-notebook-root'
export const NOTEBOOKS_MAP_KEY = 'notebooks'              // Y.Map<YNotebook>
export const NOTEBOOK_ORDER_KEY = 'notebook-order'        // Y.Array<string>
export const SCHEMA_META_KEY = 'schema-meta'              // Y.Map<{version:number, app?:string}>

// Notebook keys
export const NB_ID = 'id'
export const NB_TITLE = 'title'
export const NB_DATABASE_ID = 'databaseId'
export const NB_TAGS = 'tags'                              // Y.Array<string>
export const NB_METADATA = 'metadata'                      // Y.Map<any>
export const NB_CELLS = 'cells'                            // Y.Array<YCell>
export const NB_TOMBSTONES = 'tombstones'                  // Y.Map<boolean> (id -> true)  [soft delete]
export const NB_TOMBSTONE_META = 'tombstone-meta'          // Y.Map<string,{deletedAt:number, reason?:string}>
export const NB_CELL_INDEX_KEY = 'cell-index'              // Y.Map<string, number> (cellId -> array index)

// Cell keys
export const CELL_ID = 'id'
export const CELL_KIND = 'kind'                            // 'code' | 'markdown' | 'sql' | 'chart' | 'raw'
export const CELL_LANG = 'language'                        // optional
export const CELL_SOURCE = 'source'                        // Y.Text
export const CELL_META = 'metadata'                        // Y.Map<any>

// ExecMeta keys
export const EX_OK = 'ok'                                  // boolean
export const EX_STARTED = 'startedAt'                      // ISO string
export const EX_ENDED = 'endedAt'                          // ISO string
export const EX_DUR = 'durationMs'                         // number
export const EX_KERNEL = 'kernel'                          // string | null
export const EX_ERR = 'error'                              // string | null

// ------------------------------
// TypeScript model layer (non-Y) -- kept minimal & compatible
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
  params?: Record<string, unknown>
}

export interface CellModel {
  id: string
  kind: CellKind
  language?: string
  source: string // join(Y.Text)
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
  // SSOT: set authoritative version only here
  schemaMeta.set('version', SCHEMA_VERSION)

  return { root, notebooksMap, notebookOrder, schemaMeta }
}

// ------------------------------
// Creation helpers
// ------------------------------
export const createDefaultNotebookMetadata = (): NotebookMetadataModel => ({
  appVersion: undefined,
})

export const createNotebook = (init?: Partial<NotebookModel>): YNotebook => {
  const nb = new Y.Map<any>()

  nb.set(NB_ID, init?.id ?? ulid())
  nb.set(NB_TITLE, init?.title ?? 'Untitled Notebook')
  nb.set(NB_DATABASE_ID, init?.databaseId ?? null)

  const tags = new Y.Array<string>()
  ;(init?.tags ?? []).forEach(t => tags.push([t]))
  nb.set(NB_TAGS, tags)

  // metadata (no schemaVersion here)
  const meta = new Y.Map<any>()
  const metaVal = { ...createDefaultNotebookMetadata(), ...(init?.metadata ?? {}) }
  for (const [k, v] of Object.entries(metaVal)) meta.set(k, v)
  nb.set(NB_METADATA, meta)

  // cells
  const cells = new Y.Array<YCell>()
  ;(init?.cells ?? []).forEach(c => cells.push([createCell(c)]))
  nb.set(NB_CELLS, cells)

  // tombstones
  const tomb = new Y.Map<boolean>()
  if (init?.tombstones) for (const k of Object.keys(init.tombstones)) tomb.set(k, true)
  nb.set(NB_TOMBSTONES, tomb)

  // tombstone meta
  nb.set(NB_TOMBSTONE_META, new Y.Map<any>())

  // derived index (hint)
  nb.set(NB_CELL_INDEX_KEY, new Y.Map<number>())
  rebuildCellIndex(nb) // initial build

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

  // metadata
  const m = new Y.Map<any>()
  const mval: CellMetadataModel = { collapsed: false, executionPolicy: 'manual', ...(init?.metadata ?? {}) }
  for (const [k, v] of Object.entries(mval)) m.set(k, v)
  c.set(CELL_META, m)

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

// ----- Derived Index (CRDT-hint) -----
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

function shiftIndexGreaterOrEqual(idx: Y.Map<number>, start: number, delta: number) {
  const pairs: Array<[string, number]> = []
  idx.forEach((i, id) => { if (i >= start) pairs.push([id, i + delta]) })
  pairs.forEach(([id, v]) => idx.set(id, v))
}
function removeIndexInRange(idx: Y.Map<number>, from: number, to: number) {
  const ids: string[] = []
  idx.forEach((i, id) => { if (i >= from && i < to) ids.push(id) })
  ids.forEach(id => idx.delete(id))
}

// apply Y.Array delta to keep derived index up-to-date (call inside cells.observe handler)
export const applyCellsDeltaToIndex = (nb: YNotebook, delta: Array<{insert?: YCell[]; delete?: number; retain?: number}>) => {
  const idx = getCellIndexMap(nb)
  let cursor = 0
  delta.forEach(op => {
    if (op.insert) {
      const n = op.insert.length
      shiftIndexGreaterOrEqual(idx, cursor, +n)
      op.insert.forEach((c, k) => idx.set(c.get(CELL_ID), cursor + k))
      cursor += n
    } else if (op.delete) {
      removeIndexInRange(idx, cursor, cursor + op.delete)
      shiftIndexGreaterOrEqual(idx, cursor + op.delete, -op.delete)
      // cursor unchanged
    } else if (op.retain) {
      cursor += op.retain
    }
  })
}

export const getCellById = (nb: YNotebook, id: string, memIndex?: Map<string, number>): YCell | undefined => {
  const cells = nb.get(NB_CELLS) as Y.Array<YCell> | undefined
  if (!cells) return
  const i0 = memIndex?.get(id)
  if (i0 != null) return cells.get(i0)
  const idx = getCellIndexMap(nb).get(id)
  if (idx != null) return cells.get(idx)
  return cells.toArray().find(c => c.get(CELL_ID) === id)
}

// ------------------------------
// Model conversion (Y -> Plain)
// ------------------------------
export const yCellToModel = (c: YCell): CellModel => {
  const src = (c.get(CELL_SOURCE) as Y.Text | undefined)?.toString() ?? ''

  const mdY = c.get(CELL_META) as Y.Map<any> | undefined
  const metadata: CellMetadataModel = {
    collapsed: mdY?.get('collapsed') ?? false,
    executionPolicy: mdY?.get('executionPolicy') ?? 'manual',
  }

  return {
    id: c.get(CELL_ID),
    kind: c.get(CELL_KIND),
    language: c.get(CELL_LANG) ?? undefined,
    source: src,
    metadata,
  }
}

export const yNotebookToModel = (nb: YNotebook): NotebookModel => {
  const tags = (nb.get(NB_TAGS) as Y.Array<string> | undefined)?.toArray() ?? []
  const metaY = nb.get(NB_METADATA) as Y.Map<any> | undefined
  const metadata: NotebookMetadataModel = {
    appVersion: metaY?.get('appVersion') ?? undefined,
    notebookType: metaY?.get('notebookType') ?? undefined,
  }

  const cellsArr = (nb.get(NB_CELLS) as Y.Array<YCell> | undefined)?.toArray() ?? []
  const cells = cellsArr.map(yCellToModel)

  const tomb = nb.get(NB_TOMBSTONES) as Y.Map<boolean> | undefined
  const tombstones: Record<string, true> = {}
  tomb?.forEach((v, k) => { if (v) tombstones[k] = true })

  return {
    id: nb.get(NB_ID),
    title: nb.get(NB_TITLE) ?? 'Untitled Notebook',
    databaseId: nb.get(NB_DATABASE_ID) ?? null,
    tags,
    metadata,
    cells,
    tombstones,
  }
}

// ------------------------------
// Tombstones & Integrity (v3.2)
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

// two-phase delete: remove from array + mark tombstone + record deletedAt
export const softDeleteCell = (nb: YNotebook, cellId: string, reason?: string) => {
  const arr = getCellsArray(nb)
  const idx = arr.toArray().findIndex(c => c.get(CELL_ID) === cellId)
  if (idx >= 0) arr.delete(idx, 1)

  const t = tombstonesMap(nb)
  t.set(cellId, true)

  const tm = tombstoneMetaMap(nb)
  const now = Date.now()
  if (now >= WALL_CLOCK_EPOCH_FLOOR_MS) tm.set(cellId, { deletedAt: now, reason })
}

// local, idempotent GC of tombstone marks after TTL; does not resurrect anything
export const vacuumNotebook = (nb: YNotebook, ttlMs = 30 * 24 * 3600 * 1000) => {
  const t = tombstonesMap(nb)
  const tm = tombstoneMetaMap(nb)
  const now = Date.now()

  t.forEach((flag, id) => {
    if (!flag) return
    const meta = tm.get(id) as { deletedAt?: number } | undefined
    const deletedAt = meta?.deletedAt ?? 0
    if (deletedAt === 0) return // legacy: no timestamp -> never GC automatically
    if (now - deletedAt < ttlMs) return

    // ensure no cell with this id remains
    const arr = getCellsArray(nb)
    const stillThere = arr.toArray().some(c => c.get(CELL_ID) === id)
    if (stillThere) return

    // no cross-references in current SQL notebook; if future refs exist, check here.
    t.delete(id)
    tm.delete(id)
  })
}

// ------------------------------
// Migrations
// ------------------------------
export type Migration = (nb: YNotebook) => void

const MIGRATIONS: Record<number, Migration> = {
  // v2, v3 from your previous code if needed...
  32: (nb) => {
    // v3.2:
    // 1) Remove per-notebook schemaVersion (SSOT now global)
    const meta = nb.get(NB_METADATA) as Y.Map<any> | undefined
    if (meta?.has('schemaVersion')) meta.delete('schemaVersion')

    // 2) Ensure tombstone-meta map exists
    tombstoneMetaMap(nb)

    // 3) Ensure derived cell index exists and rebuild once
    rebuildCellIndex(nb)
  },
}

export const migrateNotebookIfNeeded = (nb: YNotebook) => {
  // authoritative version lives under root.schema-meta (SSOT)
  // but per-notebook migration is still applied to the content
  const meta = nb.get(NB_METADATA) as Y.Map<any> | undefined
  // fallback detect: if old notebooks kept schemaVersion, use it; else guess <=31
  const legacy = meta?.get('schemaVersion')
  const current = (typeof legacy === 'number') ? legacy : 31 // assume <= 31 before v3.2
  if (current === SCHEMA_VERSION) return
  for (let v = current + 1; v <= SCHEMA_VERSION; v++) {
    const mig = MIGRATIONS[v]
    if (mig) mig(nb)
  }
  // do NOT write schemaVersion back to notebook metadata (SSOT change)
}

// ------------------------------
// Undo/Redo boundaries (recommended usage)
// ------------------------------
export const createNotebookUndoManager = (nb: YNotebook) => {
  const scopes: any[] = []
  const cells = nb.get(NB_CELLS) as Y.Array<YCell>
  if (cells) scopes.push(cells)
  const meta = nb.get(NB_METADATA) as Y.Map<any>
  if (meta) scopes.push(meta)

  // Optional: track tombstones/index maps too if you want undo for deletions/reorders hints
  const tomb = nb.get(NB_TOMBSTONES) as Y.Map<boolean>
  if (tomb) scopes.push(tomb)
  const tombMeta = nb.get(NB_TOMBSTONE_META) as Y.Map<any>
  if (tombMeta) scopes.push(tombMeta)
  const idx = nb.get(NB_CELL_INDEX_KEY) as Y.Map<number>
  if (idx) scopes.push(idx)

  return new Y.UndoManager(scopes)
}

// ------------------------------
// Validation & Self-heal
// ------------------------------
export interface ValidationIssue { path: string; level: 'error'|'warning'; message: string }

export const validateNotebook = (nb: YNotebook): ValidationIssue[] => {
  const issues: ValidationIssue[] = []
  // IDs uniqueness + kind presence
  const ids = new Set<string>()
  const dups: string[] = []
  const arr = nb.get(NB_CELLS) as Y.Array<YCell> | undefined
  arr?.forEach((c, idx) => {
    const id = c.get(CELL_ID)
    if (ids.has(id)) dups.push(id)
    ids.add(id)
    const kind = c.get(CELL_KIND)
    if (!kind) issues.push({ path: `cells[${idx}]`, level: 'error', message: 'Missing cell kind' })
  })
  if (dups.length) issues.push({ path: 'cells', level: 'error', message: `Duplicate cell ids: ${dups.join(', ')}` })

  // SSOT: no schemaVersion under notebook metadata
  const meta = nb.get(NB_METADATA) as Y.Map<any> | undefined
  if (meta?.has('schemaVersion')) {
    meta.delete('schemaVersion')
    issues.push({ path: 'metadata.schemaVersion', level: 'warning', message: 'Removed per-notebook schemaVersion (SSOT is root.schema-meta.version).' })
  }

  // Derived index check: spot-check or full compare (here full compare)
  const idxMap = getCellIndexMap(nb)
  let mismatch = false
  arr?.toArray().forEach((c, i) => {
    const id = c.get(CELL_ID)
    const idx = idxMap.get(id)
    if (idx !== i) mismatch = true
  })
  if (mismatch) {
    rebuildCellIndex(nb)
    issues.push({ path: 'cell-index', level: 'warning', message: 'Rebuilt cell-index from NB_CELLS (derived hint was inconsistent).' })
  }

  // Tombstone sanity: if a tombstoned id still appears in NB_CELLS, warn
  const t = tombstonesMap(nb)
  t?.forEach((v, id) => {
    if (!v) return
    const stillThere = arr?.toArray().some(c => c.get(CELL_ID) === id)
    if (stillThere) issues.push({ path: `tombstones.${id}`, level: 'warning', message: `Cell ${id} is tombstoned but still present in cells array.` })
  })

  return issues
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
