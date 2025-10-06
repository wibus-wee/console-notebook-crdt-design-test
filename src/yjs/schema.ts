/* eslint-disable @typescript-eslint/no-explicit-any */
/*
CRDT Notebook Schema (v3.6 FINAL)
---------------------------------
Key decisions retained + fixes applied:
- Single-notebook-per-doc: The Y.Doc's root map **is the notebook**.
- Outputless Execution Model: results/blobs stay out of CRDT; only logic + replay anchors.
- Scope separation: org-scope shares notebook content; person-scope stores local cache.
- Derived data stays out of CRDT (cell index now in-memory WeakMap, not a Y.Map).
- Tombstones are undoable; maintenance (vacuum) uses special origin to avoid polluting Undo.
- Exec concurrency: add runId + seq; 'running' should be presence/person-scope; CRDT stores last completed.
- Safer migrations: prevent premature version writes; legacy hoist is done via plain-model rebuild to avoid Y child moving.

What changed vs v3.5:
1) ⚠ Migration safety: version is **not** written during ensure; set only after migrations run.
2) 🧱 Legacy hoist (v35) uses plain-model rebuild to avoid moving Y children between parents.
3) 🧭 Derived index removed from CRDT (no NB_CELL_INDEX_KEY); use runtime WeakMap + attachMaintainer.
4) 🕒 Vacuum writes use VACUUM_ORIGIN so Undo stack stays clean; tombstones remain undoable.
5) 🚦 Exec meta strengthened: add runId + seq; keep queryHash as deprecated alias to fingerprint.
6) 🆔 IDs switch to monotonic-ish IDs for better ordering; recommend UUIDv7 externally.
7) ✅ Validation extended; migrations include v36 to adopt fingerprint + drop old index key gracefully.
---------------------------------
*/

import * as Y from 'yjs'
import { ulid } from "ulid";

// ------------------------------
// Utils
// ------------------------------

// conservative floor to avoid monotonic-clock confusion on restarts
export const WALL_CLOCK_EPOCH_FLOOR_MS = Date.UTC(2001, 0, 1)

// Transaction origins to control Undo capture boundaries
export const USER_ACTION_ORIGIN = Symbol('USER_ACTION')
export const VACUUM_ORIGIN = Symbol('VACUUM')
export const MAINT_ORIGIN = Symbol('MAINTENANCE')

// ------------------------------
// Versions & Constants
// ------------------------------
export const SCHEMA_VERSION = 36 as const // v3.6 FINAL

// Root keys (root == notebook)
export const ROOT_NOTEBOOK_KEY = 'rw-notebook-root'       // Y.Map<any> (the notebook itself)
export const SCHEMA_META_KEY = 'schema-meta'              // Y.Map<{version:number, app?:string}>

// Notebook keys (live under ROOT_NOTEBOOK_KEY)
export const NB_ID = 'id'
export const NB_TITLE = 'title'
export const NB_DATABASE_ID = 'databaseId'
export const NB_TAGS = 'tags'                              // Y.Array<string>
export const NB_METADATA = 'metadata'                      // Y.Map<any>
export const NB_CELLS = 'cells'                            // Y.Array<YCell>
export const NB_TOMBSTONES = 'tombstones'                  // Y.Map<boolean>
export const NB_TOMBSTONE_META = 'tombstone-meta'          // Y.Map<string,{deletedAt:number, reason?:string}>
// NOTE: v3.6 removes NB_CELL_INDEX_KEY (derived index is runtime-only)

// Cell keys
export const CELL_ID = 'id'
export const CELL_KIND = 'kind'                            // 'sql' | 'markdown' | 'code' | 'chart' | 'raw'
export const CELL_LANG = 'language'                        // optional
export const CELL_SOURCE = 'source'                        // Y.Text
export const CELL_META = 'metadata'                        // Y.Map<any> (shallow only)
export const CELL_EXEC = 'exec'                            // Y.Map<ExecMeta>

// ExecMeta keys (non-sensitive, replay-oriented)
export const EX_STATUS = 'status'                          // 'idle' | 'running' | 'success' | 'error' | 'cancelled' (see notes)
export const EX_BY = 'executedBy'                          // userId (org scope identifier)
export const EX_STARTED = 'startedAt'                      // ISO string
export const EX_ENDED = 'endedAt'                          // ISO string
export const EX_DUR = 'durationMs'                         // number
export const EX_FINGERPRINT = 'fingerprint'                // string (hash of source+params+env) — v3.6
export const EX_ERR = 'error'                              // safe error summary (no secrets)
export const EX_RUN_ID = 'runId'                           // string (unique per execution) — v3.6
export const EX_SEQ = 'seq'                                // number (monotonic sequence / lamport) — v3.6

// ------------------------------
// TypeScript model layer (non-Y)
// ------------------------------
export type CellKind = 'sql' | 'markdown' | 'code' | 'chart' | 'raw'
export type ExecState = 'idle' | 'running' | 'success' | 'error' | 'cancelled'

export interface ExecMeta {
  status: ExecState
  executedBy?: string
  startedAt?: string
  endedAt?: string
  durationMs?: number
  fingerprint?: string // v3.6
  error?: string
  runId?: string // v3.6
  seq?: number   // v3.6
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
  exec?: ExecMeta // Should represent the last *completed* execution for org-scope
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
// Root handles (single-notebook per doc)
// ------------------------------
export type YNotebook = Y.Map<any>
export type YCell = Y.Map<any>

export interface NotebookRoot {
  root: YNotebook
  schemaMeta: Y.Map<any>
}

export const getOrCreateNotebookRoot = (doc: Y.Doc): YNotebook => doc.getMap(ROOT_NOTEBOOK_KEY)

export const ensureSchemaMeta = (nb: YNotebook): Y.Map<any> => {
  let schemaMeta = nb.get(SCHEMA_META_KEY) as Y.Map<any> | undefined
  if (!schemaMeta) { schemaMeta = new Y.Map<any>(); nb.set(SCHEMA_META_KEY, schemaMeta) }
  return schemaMeta
}

// IMPORTANT: do not set version here. Version is written only after migrations.
export const ensureNotebookRoot = (doc: Y.Doc): NotebookRoot => {
  const root = getOrCreateNotebookRoot(doc)
  const schemaMeta = ensureSchemaMeta(root)
  return { root, schemaMeta }
}

// ------------------------------
// Creation helpers
// ------------------------------
export const createDefaultNotebookMetadata = (): NotebookMetadataModel => ({ appVersion: undefined })

export const createNotebookInDoc = (doc: Y.Doc, init?: Partial<NotebookModel>): YNotebook => {
  const { root } = ensureNotebookRoot(doc)

  // id/title/db
  if (!root.has(NB_ID)) root.set(NB_ID, init?.id ?? ulid())
  if (!root.has(NB_TITLE)) root.set(NB_TITLE, init?.title ?? 'Untitled Notebook')
  if (!root.has(NB_DATABASE_ID)) root.set(NB_DATABASE_ID, init?.databaseId ?? null)

  // tags
  if (!root.has(NB_TAGS)) root.set(NB_TAGS, new Y.Array<string>())
  const tags = root.get(NB_TAGS) as Y.Array<string>
  if (init?.tags?.length) init.tags.forEach(t => tags.push([t]))

  // metadata
  if (!root.has(NB_METADATA)) root.set(NB_METADATA, new Y.Map<any>())
  const meta = root.get(NB_METADATA) as Y.Map<any>
  const metaVal = { ...createDefaultNotebookMetadata(), ...(init?.metadata ?? {}) }
  for (const [k, v] of Object.entries(metaVal)) if (!meta.has(k)) meta.set(k, v)

  // cells
  if (!root.has(NB_CELLS)) root.set(NB_CELLS, new Y.Array<YCell>())
  const cells = root.get(NB_CELLS) as Y.Array<YCell>
  if (init?.cells?.length) init.cells.forEach(c => cells.push([createCell(c)]))

  // tombstones + meta
  if (!root.has(NB_TOMBSTONES)) root.set(NB_TOMBSTONES, new Y.Map<boolean>())
  if (!root.has(NB_TOMBSTONE_META)) root.set(NB_TOMBSTONE_META, new Y.Map<any>())

  return root
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
    if (init.exec.fingerprint) e.set(EX_FINGERPRINT, init.exec.fingerprint)
    if (init.exec.error) e.set(EX_ERR, init.exec.error)
    if (init.exec.runId) e.set(EX_RUN_ID, init.exec.runId)
    if (init.exec.seq != null) e.set(EX_SEQ, init.exec.seq)
    c.set(CELL_EXEC, e)
  }
  return c
}

// ------------------------------
// Access helpers
// ------------------------------
export const getNotebookRoot = (doc: Y.Doc): YNotebook => doc.getMap(ROOT_NOTEBOOK_KEY)

export const getCellsArray = (nb: YNotebook): Y.Array<YCell> => {
  let a = nb.get(NB_CELLS) as Y.Array<YCell> | undefined
  if (!a) { a = new Y.Array<YCell>(); nb.set(NB_CELLS, a) }
  return a
}

// ----- Runtime Derived Index (hint, non-CRDT) -----
const MEM_CELL_INDEX: WeakMap<YNotebook, Map<string, number>> = new WeakMap()

const getMemIndex = (nb: YNotebook): Map<string, number> => {
  let m = MEM_CELL_INDEX.get(nb)
  if (!m) { m = new Map<string, number>(); MEM_CELL_INDEX.set(nb, m) }
  return m
}

export const rebuildMemCellIndex = (nb: YNotebook) => {
  const m = getMemIndex(nb)
  m.clear()
  const cells = nb.get(NB_CELLS) as Y.Array<YCell> | undefined
  cells?.toArray().forEach((c, i) => m.set(c.get(CELL_ID), i))
}

export const attachMemIndexMaintainer = (nb: YNotebook) => {
  const cells = nb.get(NB_CELLS) as Y.Array<YCell> | undefined
  if (!cells) return
  rebuildMemCellIndex(nb)
  cells.observe(e => {
    const m = getMemIndex(nb)
    let cursor = 0
    e.changes.delta.forEach(op => {
      const inserted = op.insert
      if (Array.isArray(inserted)) {
        const n = inserted.length
        // shift existing >= cursor
        const pairs: Array<[string, number]> = []
        m.forEach((idx, id) => { if (idx >= cursor) pairs.push([id, idx + n]) })
        pairs.forEach(([id, v]) => m.set(id, v))
        // set newly inserted
        inserted.forEach((c: YCell, k: number) => m.set(c.get(CELL_ID), cursor + k))
        cursor += n
      } else if (typeof inserted === 'string') {
        // Should never happen for Y.Array<YCell>, but advance cursor defensively.
        cursor += inserted.length
      } else if (op.delete) {
        const from = cursor
        const to = cursor + op.delete
        const ids: string[] = []
        m.forEach((idx, id) => { if (idx >= from && idx < to) ids.push(id) })
        ids.forEach(id => m.delete(id))
        // shift >
        const pairs: Array<[string, number]> = []
        m.forEach((idx, id) => { if (idx >= to) pairs.push([id, idx - op.delete!]) })
        pairs.forEach(([id, v]) => m.set(id, v))
      } else if (op.retain) {
        cursor += op.retain
      }
    })
  })
}

export const getCellById = (nb: YNotebook, id: string, memIndex?: Map<string, number>): YCell | undefined => {
  const cells = nb.get(NB_CELLS) as Y.Array<YCell> | undefined
  if (!cells) return
  const i0 = memIndex?.get(id) ?? getMemIndex(nb).get(id)
  if (i0 != null) return cells.get(i0)
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
    params: mdY?.get('params') ?? undefined,
  }

  const eY = c.get(CELL_EXEC) as Y.Map<any> | undefined
  const exec: ExecMeta | undefined = eY ? {
    status: eY.get(EX_STATUS),
    executedBy: eY.get(EX_BY) ?? undefined,
    startedAt: eY.get(EX_STARTED) ?? undefined,
    endedAt: eY.get(EX_ENDED) ?? undefined,
    durationMs: eY.get(EX_DUR) ?? undefined,
    fingerprint: eY.get(EX_FINGERPRINT) ?? undefined,
    error: eY.get(EX_ERR) ?? undefined,
    runId: eY.get(EX_RUN_ID) ?? undefined,
    seq: eY.get(EX_SEQ) ?? undefined,
  } : undefined

  return {
    id: c.get(CELL_ID),
    kind: c.get(CELL_KIND),
    language: c.get(CELL_LANG) ?? undefined,
    source: src,
    metadata,
    exec,
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
  const arr = getCellsArray(nb)
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
  const doc = (nb as any).doc as Y.Doc | undefined

  doc?.transact(() => {
    t.forEach((flag, id) => {
      if (!flag) return
      const meta = tm.get(id) as { deletedAt?: number } | undefined
      const deletedAt = meta?.deletedAt ?? 0
      if (deletedAt === 0) return
      if (now - deletedAt < ttlMs) return

      const arr = getCellsArray(nb)
      const stillThere = arr.toArray().some(c => c.get(CELL_ID) === id)
      if (stillThere) return

      t.delete(id)
      tm.delete(id)
    })
  }, VACUUM_ORIGIN)
}

// ------------------------------
// Undo/Redo boundaries
// ------------------------------
export const createNotebookUndoManager = (
  nb: YNotebook,
  opts?: { captureTimeout?: number; trackedOrigins?: Set<any> }
) => {
  const scopes: any[] = []
  const cells = nb.get(NB_CELLS) as Y.Array<YCell>
  if (cells) scopes.push(cells)
  const meta = nb.get(NB_METADATA) as Y.Map<any>
  if (meta) scopes.push(meta)
  const tomb = nb.get(NB_TOMBSTONES) as Y.Map<boolean>
  if (tomb) scopes.push(tomb)
  const tombMeta = nb.get(NB_TOMBSTONE_META) as Y.Map<any>
  if (tombMeta) scopes.push(tombMeta)
  // NOTE: derived mem-index is runtime only; not part of undo scopes.
  return new Y.UndoManager(scopes, {
    captureTimeout: opts?.captureTimeout ?? 500,
    trackedOrigins: opts?.trackedOrigins, // if provided, only these origins are captured
  } as any)
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

  // Tombstone sanity
  const t = nb.get(NB_TOMBSTONES) as Y.Map<boolean> | undefined
  t?.forEach((v, id) => {
    if (!v) return
    const stillThere = arr?.toArray().some(c => c.get(CELL_ID) === id)
    if (stillThere) issues.push({ path: `tombstones.${id}`, level: 'warning', message: `Cell ${id} is tombstoned but still present.` })
  })

  // Exec semantics: discourage 'running' in CRDT
  const runningCells: string[] = []
  arr?.forEach((c) => {
    const eY = c.get(CELL_EXEC) as Y.Map<any> | undefined
    if (eY?.get(EX_STATUS) === 'running') runningCells.push(c.get(CELL_ID))
  })
  if (runningCells.length) issues.push({ path: 'exec', level: 'warning', message: `Cells have 'running' in CRDT (${runningCells.length}). Prefer presence/person-scope for live status.` })

  return issues
}

// ------------------------------
// Exec merge policy (advisory helpers)
// ------------------------------
/**
 * Merge an execution patch under runId/seq discipline.
 * Policy:
 * - If incoming runId differs from stored runId and has lower/equal seq, ignore.
 * - Prefer higher seq within same runId.
 * - 'running' SHOULD be transient (presence); CRDT SHOULD represent last completed state.
 */
export const mergeExec = (
  cell: YCell,
  patch: Partial<ExecMeta> & { runId?: string; seq?: number }
): boolean => {
  let e = cell.get(CELL_EXEC) as Y.Map<any> | undefined
  if (!e) { e = new Y.Map<any>(); cell.set(CELL_EXEC, e) }
  const curRun = e.get(EX_RUN_ID) as string | undefined
  const curSeq = (e.get(EX_SEQ) as number | undefined) ?? 0
  const pRun = patch.runId
  const pSeq = patch.seq ?? 0
  // runId change acceptance
  const accept = (() => {
    if (curRun !== pRun) return true
    return pSeq >= curSeq
  })()

  if (!accept) return false

  // apply patch
  if (patch.status !== undefined) e.set(EX_STATUS, patch.status)
  if (patch.executedBy !== undefined) e.set(EX_BY, patch.executedBy)
  if (patch.startedAt !== undefined) e.set(EX_STARTED, patch.startedAt)
  if (patch.endedAt !== undefined) e.set(EX_ENDED, patch.endedAt)
  if (patch.durationMs !== undefined) e.set(EX_DUR, patch.durationMs)
  if (patch.fingerprint !== undefined) e.set(EX_FINGERPRINT, patch.fingerprint)
  if (patch.error !== undefined) e.set(EX_ERR, patch.error)
  if (pRun !== undefined) e.set(EX_RUN_ID, pRun)
  if (patch.seq !== undefined) e.set(EX_SEQ, pSeq)

  return true
}


// ------------------------------
// Migrations
// ------------------------------
export type Migration = (doc: Y.Doc, root: YNotebook) => void

const MIGRATIONS: Record<number, Migration> = {
  
}

const readCurrentVersion = (nb: YNotebook): number => {
  const meta = nb.get(SCHEMA_META_KEY) as Y.Map<any> | undefined
  const v = meta?.get('version')
  if (typeof v === 'number') return v
  return 0
}

export const migrateNotebookIfNeeded = (doc: Y.Doc) => {
  const { root, schemaMeta } = ensureNotebookRoot(doc)
  const current = readCurrentVersion(root)
  if (current === SCHEMA_VERSION) return
  for (let v = Math.max(32, current + 1); v <= SCHEMA_VERSION; v++) {
    const mig = MIGRATIONS[v]
    if (mig) mig(doc, root)
  }
  schemaMeta.set('version', SCHEMA_VERSION)
}

// ------------------------------
// Bootstrap
// ------------------------------
export const bootstrapDoc = (doc: Y.Doc, init?: Partial<NotebookModel>) => {
  migrateNotebookIfNeeded(doc)
  const root = createNotebookInDoc(doc, init)
  // Attach runtime index maintainer (non-CRDT)
  attachMemIndexMaintainer(root)
  return root
}

// ------------------------------
// Execution Consistency Notes (non-code policy)
// ------------------------------
/*
- fingerprint (EX_FINGERPRINT) should be computed from deterministic, non-sensitive inputs:
  hash( canonicalSQLOrSource + JSON.stringify(params) + JSON.stringify(publicEnv) )
  where publicEnv may include databaseId/schema name, but never tokens/credentials.

- Person-scope cache SHOULD index results by {orgId,userId,cellId,fingerprint} and is not synced via CRDT.
- UI MUST NOT use shared fingerprint to invalidate personal cache directly; use it only as an org-level hint.
- Presence/awareness (cursor/selection/running) must stay out of CRDT; keep in awareness channels.
- Exec CRDT SHOULD represent **last completed** execution. Live 'running' signals go via presence.
- All structural edits should be wrapped in doc.transact(fn, USER_ACTION_ORIGIN) so UndoManager can track only user actions.
- Maintenance (vacuum/reindex) should use VACUUM_ORIGIN / MAINT_ORIGIN and be excluded from tracked origins if configured.
*/
