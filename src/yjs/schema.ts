/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Y from "yjs";
import { ulid } from "ulid";

// ------------------------------
// Utils
// ------------------------------

// conservative floor to avoid monotonic-clock confusion on restarts
export const WALL_CLOCK_EPOCH_FLOOR_MS = Date.UTC(2001, 0, 1);

// Transaction origins to control Undo capture boundaries
export const USER_ACTION_ORIGIN = Symbol("USER_ACTION");
export const VACUUM_ORIGIN = Symbol("VACUUM");
export const MAINT_ORIGIN = Symbol("MAINTENANCE");

// ------------------------------
// Versions & Constants
// ------------------------------
export const SCHEMA_VERSION = 38 as const; // v3.6 FINAL

// Root keys (root == notebook)
export const ROOT_NOTEBOOK_KEY = "rw-notebook-root"; // Y.Map<any> (the notebook itself)
export const SCHEMA_META_KEY = "schema-meta"; // Y.Map<{version:number, app?:string}>

// Notebook keys (live under ROOT_NOTEBOOK_KEY)
export const NB_ID = "id";
export const NB_TITLE = "title";
export const NB_DATABASE_ID = "databaseId";
export const NB_TAGS = "tags"; // Y.Array<string>
export const NB_METADATA = "metadata"; // Y.Map<any>
export const NB_CELLS = "cells"; // Y.Array<YCell>
export const NB_TOMBSTONES = "tombstones"; // Y.Map<boolean>
export const NB_TOMBSTONE_META = "tombstone-meta"; // Y.Map<string,{deletedAt?:number, reason?:string, clock?:"trusted"|"local"}>

// Cell keys
export const CELL_ID = "id";
export const CELL_KIND = "kind"; // 'sql' | 'markdown' | 'code' | 'chart' | 'raw'
export const CELL_LANG = "language"; // optional
export const CELL_SOURCE = "source"; // Y.Text
export const CELL_META = "metadata"; // Y.Map<any> (shallow only)
export const CELL_FINGERPRINT = "fingerprint"; // string (hash of deterministic inputs)
export const CELL_EXEC_BY = "executedBy"; // optional userId (for audit)

// Guard origins
const CELL_ID_GUARD_ORIGIN = Symbol("CELL_ID_GUARD");

export interface ClockSource {
  now(): number;
  trusted: boolean;
}

export const systemClock: ClockSource = {
  now: () => Date.now(),
  trusted: false,
};

const DEFAULT_FUTURE_SKEW_MS = 5 * 60 * 1000; // 5 minutes safety window

// ------------------------------
// TypeScript model layer (non-Y)
// ------------------------------
export type CellKind = "sql" | "markdown" | "code" | "chart" | "raw";

export interface CellMetadataModel {
  backgroundDDL?: boolean; // execute DDL in background
}

export const DEFAULT_CELL_METADATA: Readonly<{
  backgroundDDL: boolean;
}> = Object.freeze({
  backgroundDDL: false,
});

export interface CellModel {
  id: string;
  kind: CellKind;
  language?: string;
  source: string; // join(Y.Text)
  metadata: CellMetadataModel;
  fingerprint?: string;
  executedBy?: string;
}

export interface NotebookMetadataModel {
  appVersion?: string;
  notebookType?: "sql" | "md" | "python" | string;
}

export interface NotebookModel {
  id: string;
  title: string;
  databaseId: string | null;
  tags: string[];
  metadata: NotebookMetadataModel;
  cells: CellModel[];
  tombstones: Record<string, true>;
}

// ------------------------------
// Root handles (single-notebook per doc)
// ------------------------------
export type YNotebook = Y.Map<any>;
export type YCell = Y.Map<any>;

export interface NotebookRoot {
  root: YNotebook;
  schemaMeta: Y.Map<any>;
}

export const getOrCreateNotebookRoot = (doc: Y.Doc): YNotebook =>
  doc.getMap(ROOT_NOTEBOOK_KEY);

export const ensureSchemaMeta = (nb: YNotebook): Y.Map<any> => {
  let schemaMeta = nb.get(SCHEMA_META_KEY) as Y.Map<any> | undefined;
  if (!schemaMeta) {
    schemaMeta = new Y.Map<any>();
    nb.set(SCHEMA_META_KEY, schemaMeta);
  }
  return schemaMeta;
};

// IMPORTANT: do not set version here. Version is written only after migrations.
export const ensureNotebookRoot = (doc: Y.Doc): NotebookRoot => {
  const root = getOrCreateNotebookRoot(doc);
  const schemaMeta = ensureSchemaMeta(root);
  return { root, schemaMeta };
};

// ------------------------------
// Creation helpers
// ------------------------------
export const ensureNotebookInDoc = (
  doc: Y.Doc,
  init?: Partial<NotebookModel>
): YNotebook => {
  const { root } = ensureNotebookRoot(doc);

  // id/title/db
  if (!root.has(NB_ID)) root.set(NB_ID, init?.id ?? ulid());
  if (!root.has(NB_TITLE))
    root.set(NB_TITLE, init?.title ?? "Untitled Notebook");
  if (!root.has(NB_DATABASE_ID))
    root.set(NB_DATABASE_ID, init?.databaseId ?? null);

  // tags
  if (!root.has(NB_TAGS)) root.set(NB_TAGS, new Y.Array<string>());
  const tags = root.get(NB_TAGS) as Y.Array<string>;
  if (init?.tags?.length) {
    const existing = new Set(tags.toArray());
    const newTags = init.tags.filter((t) => !existing.has(t));
    if (newTags.length) tags.push(newTags);
  }

  // metadata
  if (!root.has(NB_METADATA)) root.set(NB_METADATA, new Y.Map<any>());
  const meta = root.get(NB_METADATA) as Y.Map<any>;
  if (init?.metadata) {
    for (const [k, v] of Object.entries(init.metadata)) {
      if (v === undefined || meta.has(k)) continue;
      meta.set(k, v);
    }
  }

  // cells
  if (!root.has(NB_CELLS)) root.set(NB_CELLS, new Y.Array<YCell>());
  const cells = root.get(NB_CELLS) as Y.Array<YCell>;
  if (init?.cells?.length) {
    const existing = cells.toArray();
    const existingIds = new Set(existing.map((c) => c.get(CELL_ID)));
    // Avoid seeding anonymous cells when content already exists;
    // duplicates are impossible to detect without stable IDs.
    const allowBulkSeed = existing.length === 0;
    init.cells.forEach((c) => {
      const seedHasId = c.id != null;
      if (seedHasId && existingIds.has(c.id!)) return;
      if (!seedHasId && !allowBulkSeed) return;
      const yCell = createCell(c);
      cells.push([yCell]);
      existingIds.add(yCell.get(CELL_ID));
    });
  }

  // Ensure all resident cells have id guards attached.
  cells.forEach((c: YCell) => lockCellId(c));

  // tombstones + meta
  if (!root.has(NB_TOMBSTONES)) root.set(NB_TOMBSTONES, new Y.Map<boolean>());
  if (!root.has(NB_TOMBSTONE_META))
    root.set(NB_TOMBSTONE_META, new Y.Map<any>());

  return root;
};

export const createNotebookInDoc = ensureNotebookInDoc;

const CELL_ID_REGISTRY: WeakMap<YCell, string> = new WeakMap();

const lockCellId = (cell: YCell) => {
  if (CELL_ID_REGISTRY.has(cell)) return;
  const id = cell.get(CELL_ID);
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Cell id must be a non-empty string");
  }
  CELL_ID_REGISTRY.set(cell, id);
  cell.observe((event) => {
    if (event.transaction?.origin === CELL_ID_GUARD_ORIGIN) return;
    if (!event.keysChanged.has(CELL_ID)) return;
    const locked = CELL_ID_REGISTRY.get(cell);
    if (!locked) return;
    const current = cell.get(CELL_ID);
    if (current === locked) return;
    const doc = cell.doc as Y.Doc | undefined;
    const reset = () => cell.set(CELL_ID, locked);
    if (doc) {
      doc.transact(reset, CELL_ID_GUARD_ORIGIN);
    } else {
      reset();
    }
  });
};

export const createCell = (
  init?: Partial<CellModel> & { kind: CellKind }
): YCell => {
  if (!init?.kind) throw new Error("Cell kind required");
  const c = new Y.Map<any>();
  c.set(CELL_ID, init.id ?? ulid());
  c.set(CELL_KIND, init.kind);
  if (init.language) c.set(CELL_LANG, init.language);

  const text = new Y.Text();
  text.insert(0, init?.source ?? "");
  c.set(CELL_SOURCE, text);

  const m = new Y.Map<any>();
  const md = init?.metadata;
  if (md) {
    if (
      md.backgroundDDL !== undefined &&
      md.backgroundDDL !== DEFAULT_CELL_METADATA.backgroundDDL
    ) {
      m.set("backgroundDDL", md.backgroundDDL);
    }
  }
  c.set(CELL_META, m);

  if (init.fingerprint) c.set(CELL_FINGERPRINT, init.fingerprint);
  if (init.executedBy) c.set(CELL_EXEC_BY, init.executedBy);

  lockCellId(c);

  return c;
};

// ------------------------------
// Access helpers
// ------------------------------
export const getNotebookRoot = (doc: Y.Doc): YNotebook =>
  doc.getMap(ROOT_NOTEBOOK_KEY);

export const getCellsArray = (nb: YNotebook): Y.Array<YCell> => {
  let a = nb.get(NB_CELLS) as Y.Array<YCell> | undefined;
  if (!a) {
    a = new Y.Array<YCell>();
    nb.set(NB_CELLS, a);
  }
  return a;
};

// ----- Runtime Derived Index (hint, non-CRDT) -----
const MEM_CELL_INDEX: WeakMap<YNotebook, Map<string, number>> = new WeakMap();

const getMemIndex = (nb: YNotebook): Map<string, number> => {
  let m = MEM_CELL_INDEX.get(nb);
  if (!m) {
    m = new Map<string, number>();
    MEM_CELL_INDEX.set(nb, m);
  }
  return m;
};

export const rebuildMemCellIndex = (nb: YNotebook) => {
  const m = getMemIndex(nb);
  m.clear();
  const cells = nb.get(NB_CELLS) as Y.Array<YCell> | undefined;
  cells?.toArray().forEach((c, i) => {
    lockCellId(c);
    m.set(c.get(CELL_ID), i);
  });
};

export const attachMemIndexMaintainer = (nb: YNotebook) => {
  const cells = nb.get(NB_CELLS) as Y.Array<YCell> | undefined;
  if (!cells) return;
  rebuildMemCellIndex(nb);
  cells.observe((e) => {
    const m = getMemIndex(nb);
    let cursor = 0;
    e.changes.delta.forEach((op) => {
      const inserted = op.insert as YCell[] | undefined; // Notes: insert must be array of YCell
      if (inserted) {
        const n = inserted.length;
        // shift existing >= cursor
        const pairs: Array<[string, number]> = [];
        m.forEach((idx, id) => {
          if (idx >= cursor) pairs.push([id, idx + n]);
        });
        pairs.forEach(([id, v]) => m.set(id, v));
        // set newly inserted
        inserted.forEach((c: YCell, k: number) => {
          lockCellId(c);
          m.set(c.get(CELL_ID), cursor + k);
        });
        cursor += n;
      }
      if (op.delete) {
        const from = cursor;
        const to = cursor + op.delete;
        const ids: string[] = [];
        m.forEach((idx, id) => {
          if (idx >= from && idx < to) ids.push(id);
        });
        ids.forEach((id) => m.delete(id));
        // shift >
        const pairs: Array<[string, number]> = [];
        m.forEach((idx, id) => {
          if (idx >= to) pairs.push([id, idx - op.delete!]);
        });
        pairs.forEach(([id, v]) => m.set(id, v));
      } else if (op.retain) {
        cursor += op.retain;
      }
    });
  });
};

export const getCellById = (
  nb: YNotebook,
  id: string,
  memIndex?: Map<string, number>
): YCell | undefined => {
  const cells = nb.get(NB_CELLS) as Y.Array<YCell> | undefined;
  if (!cells) return;
  const i0 = memIndex?.get(id) ?? getMemIndex(nb).get(id);
  if (i0 != null) return cells.get(i0);
  return cells.toArray().find((c) => c.get(CELL_ID) === id);
};

// ------------------------------
// Model conversion (Y -> Plain)
// ------------------------------
export const yCellToModel = (c: YCell): CellModel => {
  const src = (c.get(CELL_SOURCE) as Y.Text | undefined)?.toString() ?? "";

  const mdY = c.get(CELL_META) as Y.Map<any> | undefined;
  const metadata: CellMetadataModel = {
    backgroundDDL: mdY?.get("backgroundDDL") ?? DEFAULT_CELL_METADATA.backgroundDDL,
  };

  return {
    id: c.get(CELL_ID),
    kind: c.get(CELL_KIND),
    language: c.get(CELL_LANG) ?? undefined,
    source: src,
    metadata,
    fingerprint: c.get(CELL_FINGERPRINT) ?? undefined,
    executedBy: c.get(CELL_EXEC_BY) ?? undefined,
  };
};

export const yNotebookToModel = (nb: YNotebook): NotebookModel => {
  const tags =
    (nb.get(NB_TAGS) as Y.Array<string> | undefined)?.toArray() ?? [];
  const metaY = nb.get(NB_METADATA) as Y.Map<any> | undefined;
  const metadata: NotebookMetadataModel = {
    appVersion: metaY?.get("appVersion") ?? undefined,
    notebookType: metaY?.get("notebookType") ?? undefined,
  };
  const cellsArr =
    (nb.get(NB_CELLS) as Y.Array<YCell> | undefined)?.toArray() ?? [];
  const cells = cellsArr.map(yCellToModel);
  const tomb = nb.get(NB_TOMBSTONES) as Y.Map<boolean> | undefined;
  const tombstones: Record<string, true> = {};
  tomb?.forEach((v, k) => {
    if (v) tombstones[k] = true;
  });

  return {
    id: nb.get(NB_ID),
    title: nb.get(NB_TITLE) ?? "Untitled Notebook",
    databaseId: nb.get(NB_DATABASE_ID) ?? null,
    tags,
    metadata,
    cells,
    tombstones,
  };
};

// ------------------------------
// Tombstones & Integrity
// ------------------------------
export const tombstonesMap = (nb: YNotebook): Y.Map<boolean> => {
  let t = nb.get(NB_TOMBSTONES) as Y.Map<boolean> | undefined;
  if (!t) {
    t = new Y.Map<boolean>();
    nb.set(NB_TOMBSTONES, t);
  }
  return t;
};

export type TombstoneClock = "trusted" | "local";

export interface TombstoneMeta {
  deletedAt?: number;
  reason?: string;
  clock?: TombstoneClock;
}

const isValidTombstoneClock = (value: unknown): value is TombstoneClock =>
  value === "trusted" || value === "local";

export const tombstoneMetaMap = (nb: YNotebook): Y.Map<TombstoneMeta> => {
  let m = nb.get(NB_TOMBSTONE_META) as Y.Map<TombstoneMeta> | undefined;
  if (!m) {
    m = new Y.Map<TombstoneMeta>();
    nb.set(NB_TOMBSTONE_META, m);
  }
  return m;
};

export interface SoftDeleteOptions {
  timestamp?: number;
  trusted?: boolean;
  clock?: ClockSource;
}

const resolveDeletionTimestamp = (
  opts?: SoftDeleteOptions
): { timestamp?: number; clock?: TombstoneClock } => {
  const fallbackClock = opts?.clock ?? systemClock;
  const hasExplicitTimestamp = opts?.timestamp != null;
  const ts = hasExplicitTimestamp
    ? opts!.timestamp!
    : fallbackClock.now();

  if (typeof ts !== "number" || Number.isNaN(ts)) return {};
  if (ts < WALL_CLOCK_EPOCH_FLOOR_MS) return {};

  const trusted =
    opts?.trusted ??
    (hasExplicitTimestamp
      ? true
      : fallbackClock.trusted ?? false);

  return { timestamp: ts, clock: trusted ? "trusted" : "local" };
};

const writeTombstoneMeta = (
  tm: Y.Map<TombstoneMeta>,
  id: string,
  update: Partial<TombstoneMeta>
) => {
  const current = tm.get(id);
  const next: TombstoneMeta = { ...current, ...update };
  tm.set(id, next);
};

export const softDeleteCell = (
  nb: YNotebook,
  cellId: string,
  reason?: string,
  opts?: SoftDeleteOptions
) => {
  const doc = nb.doc as Y.Doc | undefined;
  const applyDelete = () => {
    const arr = getCellsArray(nb);
    const idx = arr.toArray().findIndex((c) => c.get(CELL_ID) === cellId);
    if (idx >= 0) arr.delete(idx, 1);

    const t = tombstonesMap(nb);
    t.set(cellId, true);

    const tm = tombstoneMetaMap(nb);
    const resolved = resolveDeletionTimestamp(opts);
    const metaUpdate: Partial<TombstoneMeta> = {};
    const actualReason = reason ?? undefined;
    if (actualReason !== undefined) metaUpdate.reason = actualReason;
    if (resolved.timestamp !== undefined) metaUpdate.deletedAt = resolved.timestamp;
    if (resolved.clock) metaUpdate.clock = resolved.clock;
    if (Object.keys(metaUpdate).length) {
      writeTombstoneMeta(tm, cellId, metaUpdate);
    } else if (!tm.has(cellId)) {
      tm.set(cellId, {});
    }
  };

  if (doc) {
    doc.transact(applyDelete, USER_ACTION_ORIGIN);
  } else {
    applyDelete();
  }
};

export interface TombstoneTimestampOptions {
  reason?: string;
  trusted?: boolean;
  origin?: symbol;
  clock?: ClockSource;
}

export const setTombstoneTimestamp = (
  nb: YNotebook,
  cellId: string,
  timestamp: number,
  opts?: TombstoneTimestampOptions
) => {
  if (typeof timestamp !== "number" || Number.isNaN(timestamp)) return;
  if (timestamp < WALL_CLOCK_EPOCH_FLOOR_MS) return;

  const resolvedClock =
    opts?.trusted ?? opts?.clock?.trusted ?? true
      ? ("trusted" as TombstoneClock)
      : ("local" as TombstoneClock);

  const doc = nb.doc as Y.Doc | undefined;
  const apply = () => {
    const tombstones = tombstonesMap(nb);
    if (!tombstones.get(cellId)) tombstones.set(cellId, true);

    const tm = tombstoneMetaMap(nb);
    const update: Partial<TombstoneMeta> = {
      deletedAt: timestamp,
      clock: resolvedClock,
    };
    if (opts?.reason !== undefined) update.reason = opts.reason;
    writeTombstoneMeta(tm, cellId, update);
  };

  if (doc) {
    doc.transact(apply, opts?.origin ?? MAINT_ORIGIN);
  } else {
    apply();
  }
};

export const vacuumNotebook = (
  nb: YNotebook,
  ttlMs = 30 * 24 * 3600 * 1000,
  opts?: {
    clock?: ClockSource;
    now?: number;
    nowTrusted?: boolean;
    acceptUntrustedClock?: boolean;
    maxFutureSkewMs?: number;
  }
) => {
  const t = tombstonesMap(nb);
  const tm = tombstoneMetaMap(nb);
  const clock = opts?.clock;
  const nowValue = opts?.now ?? (clock ? clock.now() : systemClock.now());
  const nowTrusted =
    opts?.nowTrusted ??
    (opts?.now != null ? true : clock?.trusted ?? false);
  const maxFutureSkew = opts?.maxFutureSkewMs ?? DEFAULT_FUTURE_SKEW_MS;
  const allowUntrusted = opts?.acceptUntrustedClock ?? false;
  const doc = (nb as any).doc as Y.Doc | undefined;

  const sweep = () => {
    t.forEach((flag, id) => {
      if (!flag) return;
      const meta = tm.get(id);
      const deletedAt = meta?.deletedAt;
      const clockLabel = meta?.clock;

      if (deletedAt == null || deletedAt <= 0) return;

      const timestampTrusted = clockLabel === "trusted";
      if (timestampTrusted && !nowTrusted) return;
      if (!timestampTrusted && !allowUntrusted) return;

      if (deletedAt - nowValue > maxFutureSkew) return;
      if (nowValue - deletedAt < ttlMs) return;

      const arr = getCellsArray(nb);
      const stillThere = arr.toArray().some((c) => c.get(CELL_ID) === id);
      if (stillThere) return;

      t.delete(id);
      tm.delete(id);
    });
  };

  if (doc) {
    doc.transact(sweep, VACUUM_ORIGIN);
  } else {
    sweep();
  }
};

// ------------------------------
// Undo/Redo boundaries
// ------------------------------
export const createNotebookUndoManager = (
  nb: YNotebook,
  /** 请把 trackedOrigins 限定为用户动作（例如只追踪 USER_ACTION_ORIGIN），这样 vacuum 不会进入撤销栈。 */
  opts?: { captureTimeout?: number; trackedOrigins?: Set<any> }
) => {
  const scopes: any[] = [];
  const cells = nb.get(NB_CELLS) as Y.Array<YCell>;
  if (cells) scopes.push(cells);
  const meta = nb.get(NB_METADATA) as Y.Map<any>;
  if (meta) scopes.push(meta);
  const tomb = nb.get(NB_TOMBSTONES) as Y.Map<boolean>;
  if (tomb) scopes.push(tomb);
  const tombMeta = nb.get(NB_TOMBSTONE_META) as Y.Map<any>;
  if (tombMeta) scopes.push(tombMeta);
  // NOTE: derived mem-index is runtime only; not part of undo scopes.
  return new Y.UndoManager(scopes, {
    captureTimeout: opts?.captureTimeout ?? 500,
    trackedOrigins: opts?.trackedOrigins, // if provided, only these origins are captured
  } as any);
};

// ------------------------------
// Validation & Self-heal
// ------------------------------
export interface ValidationIssue {
  path: string;
  level: "error" | "warning";
  message: string;
}

export const validateNotebook = (nb: YNotebook): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];

  // IDs uniqueness + kind presence
  const ids = new Set<string>();
  const dups: string[] = [];
  const arr = nb.get(NB_CELLS) as Y.Array<YCell> | undefined;
  arr?.forEach((c, idx) => {
    const id = c.get(CELL_ID);
    if (ids.has(id)) dups.push(id);
    ids.add(id);
    const kind = c.get(CELL_KIND);
    if (!kind)
      issues.push({
        path: `cells[${idx}]`,
        level: "error",
        message: "Missing cell kind",
      });
  });
  if (dups.length)
    issues.push({
      path: "cells",
      level: "error",
      message: `Duplicate cell ids: ${dups.join(", ")}`,
    });

  // Tombstone sanity
  const t = nb.get(NB_TOMBSTONES) as Y.Map<boolean> | undefined;
  t?.forEach((v, id) => {
    if (!v) return;
    const stillThere = arr?.toArray().some((c) => c.get(CELL_ID) === id);
    if (stillThere)
      issues.push({
        path: `tombstones.${id}`,
        level: "warning",
        message: `Cell ${id} is tombstoned but still present.`,
      });
  });

  const tm = nb.get(NB_TOMBSTONE_META) as Y.Map<TombstoneMeta> | undefined;
  tm?.forEach((meta, id) => {
    if (!meta) return;
    if (
      meta.deletedAt != null &&
      (typeof meta.deletedAt !== "number" || Number.isNaN(meta.deletedAt))
    ) {
      issues.push({
        path: `tombstone-meta.${id}`,
        level: "warning",
        message: `Invalid deletedAt for tombstone ${id}`,
      });
    }
    if (meta.clock != null && !isValidTombstoneClock(meta.clock)) {
      issues.push({
        path: `tombstone-meta.${id}`,
        level: "warning",
        message: `Invalid clock tag for tombstone ${id}`,
      });
    }
  });

  return issues;
};

// ------------------------------
// Migrations
// ------------------------------
export type Migration = (doc: Y.Doc, root: YNotebook) => void;

const MIGRATIONS: Record<number, Migration> = {};

const readCurrentVersion = (nb: YNotebook): number => {
  const meta = nb.get(SCHEMA_META_KEY) as Y.Map<any> | undefined;
  const v = meta?.get("version");
  if (typeof v === "number") return v;
  return 0;
};

export const migrateNotebookIfNeeded = (doc: Y.Doc) => {
  const { root, schemaMeta } = ensureNotebookRoot(doc);
  const current = readCurrentVersion(root);
  if (current === SCHEMA_VERSION) return;
  for (let v = Math.max(32, current + 1); v <= SCHEMA_VERSION; v++) {
    const mig = MIGRATIONS[v];
    if (mig) mig(doc, root);
  }
  schemaMeta.set("version", SCHEMA_VERSION);
};

// ------------------------------
// Bootstrap
// ------------------------------
export const bootstrapDoc = (doc: Y.Doc, init?: Partial<NotebookModel>) => {
  migrateNotebookIfNeeded(doc);
  const root = ensureNotebookInDoc(doc, init);
  // Attach runtime index maintainer (non-CRDT)
  attachMemIndexMaintainer(root);
  return root;
};
