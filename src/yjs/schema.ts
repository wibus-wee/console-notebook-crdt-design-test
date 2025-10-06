/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Y from "yjs";
import { ulid } from "ulid";

/**
 * Notebook CRDT Schema (v1.000.000, Map+Order edition)
 * ----------------------------------------------------
 * 设计原则：
 * 1) O(1) 查找：所有 Cell 实体存入 Y.Map<string, YCell> (NB_CELL_MAP)
 * 2) 稳定顺序：单独用 Y.Array<string> (NB_CELL_ORDER) 维护有序 cellId 列表
 * 3) CRDT 安全：所有结构均为 Y 原生类型；不使用进程内 “mem index”
 * 4) 事务边界：使用 origin 区分用户操作与维护操作，UndoManager 仅追踪用户操作
 */

// ------------------------------
// Utils & Origins
// ------------------------------

/** 保守下限：避免重启后单调时钟与墙钟混淆 */
export const WALL_CLOCK_EPOCH_FLOOR_MS = Date.UTC(2001, 0, 1);

/** 事务来源：用于 UndoManager 过滤撤销范围 */
export const USER_ACTION_ORIGIN = Symbol("USER_ACTION"); // 用户触发操作（可撤销）
export const VACUUM_ORIGIN = Symbol("VACUUM"); // 清理操作（不可撤销）
export const MAINT_ORIGIN = Symbol("MAINTENANCE"); // 维护/修复（不可撤销）
const CELL_ID_GUARD_ORIGIN = Symbol("CELL_ID_GUARD"); // 内部保护（不可撤销）

// ------------------------------
// Versions & Root Keys
// ------------------------------
export const FIRST_SCHEMA_VERSION = 1_000_000 as const;
export const SCHEMA_VERSION = 1_000_000 as const; // v1.000.000

/** Root map 即 notebook 本体（单文档仅承载一个 notebook） */
export const ROOT_NOTEBOOK_KEY = "rw-notebook-root"; // Y.Map<any>
export const SCHEMA_META_KEY = "schema-meta"; // Y.Map<{version:number, app?:string}>

/** Notebook scalar/meta keys */
export const NB_ID = "id";
export const NB_TITLE = "title";
export const NB_DATABASE_ID = "databaseId";
export const NB_TAGS = "tags"; // Y.Array<string>
export const NB_METADATA = "metadata"; // Y.Map<any>

/** Notebook cell storage (Map + Order) */
export const NB_CELL_MAP = "cellMap"; // Y.Map<YCell>
export const NB_CELL_ORDER = "order"; // Y.Array<string>

/** Tombstone（软删除标记 + 元信息） */
export const NB_TOMBSTONES = "tombstones"; // Y.Map<boolean> (cellId -> true)
export const NB_TOMBSTONE_META = "tombstoneMeta"; // Y.Map<string, Y.Map<any>>

/** Cell keys */
export const CELL_ID = "id";
export const CELL_KIND = "kind"; // 'sql' | 'markdown' | 'code' | 'chart' | 'raw'
export const CELL_LANG = "language"; // optional
export const CELL_SOURCE = "source"; // Y.Text
export const CELL_META = "metadata"; // Y.Map<any> (仅浅层)
export const CELL_FINGERPRINT = "fingerprint"; // string (哈希)
export const CELL_EXEC_BY = "executedBy"; // optional userId

// ------------------------------
// Clock Source
// ------------------------------
export interface ClockSource {
  now(): number;
  trusted: boolean;
}
export const systemClock: ClockSource = {
  now: () => Date.now(),
  trusted: false,
};
const DEFAULT_FUTURE_SKEW_MS = 5 * 60 * 1000;

// ------------------------------
// TypeScript model (非 Y 层)
// ------------------------------
export type CellKind = "sql" | "markdown" | "code" | "chart" | "raw";

export interface CellMetadataModel {
  backgroundDDL?: boolean;
}
export const DEFAULT_CELL_METADATA: Readonly<CellMetadataModel> =
  Object.freeze({
    backgroundDDL: false,
  });

export interface CellModel {
  id: string;
  kind: CellKind;
  language?: string;
  source: string;
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
  order: string[]; // 有序 cellId 列表
  tombstones: Record<string, true>;
}

// ------------------------------
// Y Handles
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

/** 仅建立 root 与 schemaMeta；版本号由上层迁移器写入，这里不写入 version */
export const ensureNotebookRoot = (doc: Y.Doc): NotebookRoot => {
  const root = getOrCreateNotebookRoot(doc);
  const schemaMeta = ensureSchemaMeta(root);
  return { root, schemaMeta };
};

// ------------------------------
// Creation & Initialization
// ------------------------------
export const ensureNotebookInDoc = (
  doc: Y.Doc,
  init?: Partial<NotebookModel>
): YNotebook => {
  const { root } = ensureNotebookRoot(doc);

  // 标识字段
  if (!root.has(NB_ID)) {
    console.warn("Client-side notebook initialization occurred unexpectedly.");
    root.set(NB_ID, init?.id ?? ulid());
  }
  if (!root.has(NB_TITLE))
    root.set(NB_TITLE, init?.title ?? "Untitled Notebook");
  if (!root.has(NB_DATABASE_ID))
    root.set(NB_DATABASE_ID, init?.databaseId ?? null);

  // tags
  if (!root.has(NB_TAGS)) root.set(NB_TAGS, new Y.Array<string>());
  const tags = root.get(NB_TAGS) as Y.Array<string>;
  if (init?.tags?.length) {
    const exist = new Set(tags.toArray());
    const add: string[] = [];
    for (const tag of init.tags) {
      if (exist.has(tag)) continue;
      exist.add(tag);
      add.push(tag);
    }
    if (add.length) tags.push(add);
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

  // cell structures (Map + Order)
  if (!root.has(NB_CELL_MAP)) root.set(NB_CELL_MAP, new Y.Map<YCell>());
  if (!root.has(NB_CELL_ORDER)) root.set(NB_CELL_ORDER, new Y.Array<string>());

  // tombstones
  if (!root.has(NB_TOMBSTONES)) root.set(NB_TOMBSTONES, new Y.Map<boolean>());
  /**
   * 当多个用户并发修改不同字段（如一个更新 reason，另一个更新 deletedAt），
   * 因为 Y.Map 的值是非递归 CRDT，仍然可能互相覆盖。
   * TombstoneMetaEntry 不要整体替换，而应始终 entry.set(key, value)； 避免 tm.set(id, new Y.Map()) 这类完全替换；
   * 目前 ensureTombstoneMetaEntry 已避免这一问题
   * 但如果上层手动写入新对象则风险仍在。
   */
  if (!root.has(NB_TOMBSTONE_META))
    root.set(NB_TOMBSTONE_META, new Y.Map<TombstoneMetaEntry>());

  // optional seed
  if (init?.order?.length) {
    getCellMap(root); // Ensure NB_CELL_MAP exists
    const order = getOrder(root);
    const existing = new Set(order.toArray());
    const append: string[] = [];
    for (const id of init.order) {
      if (existing.has(id)) continue;
      existing.add(id);
      append.push(id);
    }
    if (append.length) order.push(append);
    // Note: 若需要同时种入实体，请调用 insertCell/createCell 工具函数
    // 而不是直接操作 map，以确保 cellId 锁定与变更监听生效
  }

  const cellMap = root.get(NB_CELL_MAP) as Y.Map<YCell> | undefined;
  cellMap?.forEach((cell) => {
    if (cell instanceof Y.Map) lockCellId(cell);
  });

  return root;
};

// ------------------------------
// Cell factories & guards
// ------------------------------
const CELL_ID_REGISTRY: WeakMap<YCell, string> = new WeakMap();

/** 保护 Cell id 不被后续变更（CRDT 合并后仍保持稳定主键） */
const lockCellId = (cell: YCell) => {
  if (CELL_ID_REGISTRY.has(cell)) return;
  const id = cell.get(CELL_ID);
  if (typeof id !== "string" || id.length === 0)
    throw new Error("Cell id must be a non-empty string");
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
  init: Partial<CellModel> & { kind: CellKind }
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
  if (
    md &&
    md.backgroundDDL !== undefined &&
    md.backgroundDDL !== DEFAULT_CELL_METADATA.backgroundDDL
  ) {
    m.set("backgroundDDL", md.backgroundDDL);
  }
  c.set(CELL_META, m);

  if (init.fingerprint) c.set(CELL_FINGERPRINT, init.fingerprint);
  if (init.executedBy) c.set(CELL_EXEC_BY, init.executedBy);

  lockCellId(c);
  return c;
};

// ------------------------------
// Access helpers (Map + Order)
// ------------------------------
export const getNotebookRoot = (doc: Y.Doc): YNotebook =>
  doc.getMap(ROOT_NOTEBOOK_KEY);

export const getCellMap = (nb: YNotebook): Y.Map<YCell> => {
  let m = nb.get(NB_CELL_MAP) as Y.Map<YCell> | undefined;
  if (!m) {
    m = new Y.Map<YCell>();
    nb.set(NB_CELL_MAP, m);
  }
  return m;
};

export const getOrder = (nb: YNotebook): Y.Array<string> => {
  let a = nb.get(NB_CELL_ORDER) as Y.Array<string> | undefined;
  if (!a) {
    a = new Y.Array<string>();
    nb.set(NB_CELL_ORDER, a);
  }
  return a;
};

export const getCell = (nb: YNotebook, id: string): YCell | undefined =>
  getCellMap(nb).get(id);

export const listCells = (nb: YNotebook): YCell[] => {
  const order = getOrder(nb).toArray();
  const map = getCellMap(nb);
  return order.map((id) => map.get(id)).filter((x): x is YCell => !!x);
};

// ------------------------------
// Mutations (insert / remove / move)
// ------------------------------
/** 在指定位置插入 cell（省略 index 则 append） */
export const insertCell = (
  nb: YNotebook,
  cell: YCell,
  index?: number,
  origin: symbol = USER_ACTION_ORIGIN
) => {
  const doc = nb.doc as Y.Doc | undefined;
  const id = cell.get(CELL_ID) as string;
  if (typeof id !== "string" || !id)
    throw new Error("Cell must have a valid id");

  const apply = () => {
    const map = getCellMap(nb);
    const order = getOrder(nb);
    const snapshot = order.toArray();
    for (let i = snapshot.length - 1; i >= 0; i -= 1) {
      if (snapshot[i] === id) order.delete(i, 1);
    }

    // set 先于 order.insert，避免 order 暴露悬空 id
    map.set(id, cell);
    lockCellId(cell);

    const len = order.length;
    let target = index ?? len;
    if (target < 0) target = 0;
    if (target > len) target = len;
    order.insert(target, [id]);
  };
  if (doc) {
    doc.transact(apply, origin);
  } else {
    apply();
  }
};

/** 根据 cellId 删除（硬删除：从 order 和 map 同步移除；软删除请用 softDeleteCell） */
export const removeCell = (
  nb: YNotebook,
  id: string,
  origin: symbol = USER_ACTION_ORIGIN
) => {
  const doc = nb.doc as Y.Doc | undefined;
  const apply = () => {
    const order = getOrder(nb);
    const map = getCellMap(nb);
    const snapshot = order.toArray();
    for (let i = snapshot.length - 1; i >= 0; i -= 1) {
      if (snapshot[i] === id) order.delete(i, 1);
    }
    map.delete(id);

    const tomb = nb.get(NB_TOMBSTONES) as Y.Map<boolean> | undefined;
    tomb?.delete(id);
    const tm = nb.get(NB_TOMBSTONE_META) as TombstoneMetaMap | undefined;
    tm?.delete(id);
  };
  if (doc) {
    doc.transact(apply, origin);
  } else {
    apply();
  }
};

/** 移动 cell 到新位置（稳定基于 id） */
export const moveCell = (
  nb: YNotebook,
  id: string,
  toIndex: number,
  origin: symbol = USER_ACTION_ORIGIN
) => {
  const doc = nb.doc as Y.Doc | undefined;
  const apply = () => {
    const order = getOrder(nb);
    const arr = order.toArray();
    const from = arr.indexOf(id);
    if (from < 0) return;
    const len = arr.length;
    let target = Number.isFinite(toIndex) ? toIndex : len - 1;
    if (target < 0) target = 0;
    if (target > len) target = len;
    if (target === from || (from === len - 1 && target >= len)) return;

    order.delete(from, 1);
    const newLen = order.length;
    if (target > newLen) target = newLen;
    order.insert(target, [id]);
  };
  if (doc) {
    doc.transact(apply, origin);
  } else {
    apply();
  }
};

// ------------------------------
// Model conversion (Y -> Plain)
// ------------------------------
export const yCellToModel = (c: YCell): CellModel => {
  const src = (c.get(CELL_SOURCE) as Y.Text | undefined)?.toString() ?? "";
  const mdY = c.get(CELL_META) as Y.Map<any> | undefined;
  const metadata: CellMetadataModel = {
    backgroundDDL:
      mdY?.get("backgroundDDL") ?? DEFAULT_CELL_METADATA.backgroundDDL,
  };
  const rawId = c.get(CELL_ID);
  const id = typeof rawId === "string" ? rawId : String(rawId ?? "");
  if (typeof rawId !== "string") {
    console.warn(`Cell id is not a string, got ${String(rawId)}`);
  }
  const rawKind = c.get(CELL_KIND);
  const kind = (typeof rawKind === "string" ? rawKind : "raw") as CellKind;
  if (typeof rawKind !== "string") {
    console.warn(`Cell kind is not a string for id ${id}`);
  }
  const languageValue = c.get(CELL_LANG);
  return {
    id,
    kind,
    language: typeof languageValue === "string" ? languageValue : undefined,
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
  const rawId = nb.get(NB_ID);
  const id = typeof rawId === "string" ? rawId : String(rawId ?? "");
  const rawTitle = nb.get(NB_TITLE);
  const title = typeof rawTitle === "string" ? rawTitle : "Untitled Notebook";
  const rawDbId = nb.get(NB_DATABASE_ID);
  const databaseId = typeof rawDbId === "string" ? rawDbId : null;
  const order =
    (nb.get(NB_CELL_ORDER) as Y.Array<string> | undefined)?.toArray() ?? [];
  const tomb = nb.get(NB_TOMBSTONES) as Y.Map<boolean> | undefined;
  const tombstones: Record<string, true> = {};
  tomb?.forEach((v, k) => {
    if (v) tombstones[k] = true;
  });

  return {
    id,
    title,
    databaseId,
    tags,
    metadata,
    order,
    tombstones,
  };
};

// ------------------------------
// Tombstones (soft delete) & Vacuum
// ------------------------------
export type TombstoneClock = "trusted" | "local";
export interface TombstoneMeta {
  deletedAt?: number;
  reason?: string;
  clock?: TombstoneClock;
}
export type TombstoneMetaEntry = Y.Map<any>;
export type TombstoneMetaMap = Y.Map<TombstoneMetaEntry>;

const isValidTombstoneClock = (v: unknown): v is TombstoneClock =>
  v === "trusted" || v === "local";

const ensureTombstoneMetaEntry = (
  tm: TombstoneMetaMap,
  id: string
): TombstoneMetaEntry => {
  let e = tm.get(id);
  if (!(e instanceof Y.Map)) {
    e = new Y.Map<any>();
    tm.set(id, e);
  }
  return e;
};

const readTombstoneMetaEntry = (
  entry: TombstoneMetaEntry | undefined
): TombstoneMeta => {
  if (!(entry instanceof Y.Map)) return {};
  const snapshot: TombstoneMeta = {};
  const deletedAt = entry.get("deletedAt");
  if (deletedAt !== undefined) snapshot.deletedAt = deletedAt as number;
  const reason = entry.get("reason");
  if (reason !== undefined) snapshot.reason = reason as string;
  const clock = entry.get("clock");
  if (clock !== undefined) snapshot.clock = clock as TombstoneClock;
  return snapshot;
};

export const tombstonesMap = (nb: YNotebook): Y.Map<boolean> => {
  let t = nb.get(NB_TOMBSTONES) as Y.Map<boolean> | undefined;
  if (!t) {
    t = new Y.Map<boolean>();
    nb.set(NB_TOMBSTONES, t);
  }
  return t;
};
export const tombstoneMetaMap = (nb: YNotebook): TombstoneMetaMap => {
  let m = nb.get(NB_TOMBSTONE_META) as TombstoneMetaMap | undefined;
  if (!m) {
    m = new Y.Map<TombstoneMetaEntry>();
    nb.set(NB_TOMBSTONE_META, m);
  }
  return m;
};

export interface SoftDeleteOptions {
  timestamp?: number;
  trusted?: boolean;
  clock?: ClockSource;
}

/** 软删除：从 Order 移除并设置 tombstone，保留实体至 vacuum 清理 */
export const softDeleteCell = (
  nb: YNotebook,
  cellId: string,
  reason?: string,
  opts?: SoftDeleteOptions
) => {
  const doc = nb.doc as Y.Doc | undefined;

  const resolve = (): { ts?: number; clock?: TombstoneClock } => {
    const cs = opts?.clock ?? systemClock;
    const hasTs = opts?.timestamp != null;
    const ts = hasTs ? opts!.timestamp! : cs.now();
    if (typeof ts !== "number" || Number.isNaN(ts)) return {};
    if (ts < WALL_CLOCK_EPOCH_FLOOR_MS) return {};
    const trusted = opts?.trusted ?? (hasTs ? true : cs.trusted ?? false);
    return { ts, clock: trusted ? "trusted" : "local" };
  };

  const apply = () => {
    // 从 order 移除；实体仍留在 map（可供审计/恢复），并打 tombstone
    const order = getOrder(nb);
    const snapshot = order.toArray();
    for (let i = snapshot.length - 1; i >= 0; i -= 1) {
      if (snapshot[i] === cellId) order.delete(i, 1);
    }

    const t = tombstonesMap(nb);
    t.set(cellId, true);

    const tm = tombstoneMetaMap(nb);
    const { ts, clock } = resolve();
    const entry = ensureTombstoneMetaEntry(tm, cellId);
    if (reason !== undefined) entry.set("reason", reason);
    if (ts !== undefined) entry.set("deletedAt", ts);
    if (clock) entry.set("clock", clock);
  };

  if (doc) {
    doc.transact(apply, USER_ACTION_ORIGIN);
  } else {
    apply();
  }
};

/** 恢复软删除：清除 tombstone 并按指定位置重新注入 order */
export const restoreCell = (
  nb: YNotebook,
  cellId: string,
  index?: number,
  origin: symbol = USER_ACTION_ORIGIN
) => {
  const doc = nb.doc as Y.Doc | undefined;

  const apply = () => {
    const map = getCellMap(nb);
    const cell = map.get(cellId);
    if (!cell) return;

    lockCellId(cell);

    const order = getOrder(nb);
    const snapshot = order.toArray();
    for (let i = snapshot.length - 1; i >= 0; i -= 1) {
      if (snapshot[i] === cellId) order.delete(i, 1);
    }

    const len = order.length;
    let target = index ?? len;
    if (target < 0) target = 0;
    if (target > len) target = len;
    order.insert(target, [cellId]);

    const tomb = nb.get(NB_TOMBSTONES) as Y.Map<boolean> | undefined;
    tomb?.delete(cellId);
    const tm = nb.get(NB_TOMBSTONE_META) as TombstoneMetaMap | undefined;
    tm?.delete(cellId);
  };

  if (doc) {
    doc.transact(apply, origin);
  } else {
    apply();
  }
};

export interface TombstoneTimestampOptions {
  reason?: string;
  trusted?: boolean;
  origin?: symbol;
  clock?: ClockSource;
}

/** 维护/修复：标定 tombstone 的 deletedAt（不进入撤销栈） */
export const setTombstoneTimestamp = (
  nb: YNotebook,
  cellId: string,
  timestamp: number,
  opts?: TombstoneTimestampOptions
) => {
  if (typeof timestamp !== "number" || Number.isNaN(timestamp)) return;
  if (timestamp < WALL_CLOCK_EPOCH_FLOOR_MS) return;

  const resolvedClock =
    opts?.trusted ?? opts?.clock?.trusted ?? true ? "trusted" : "local";
  const doc = nb.doc as Y.Doc | undefined;

  const apply = () => {
    // tombstone flag 至少为 true
    const tomb = tombstonesMap(nb);
    if (!tomb.get(cellId)) tomb.set(cellId, true);

    const tm = tombstoneMetaMap(nb);
    const entry = ensureTombstoneMetaEntry(tm, cellId);
    entry.set("deletedAt", timestamp);
    entry.set("clock", resolvedClock);
    if (opts?.reason !== undefined) entry.set("reason", opts.reason);
  };

  if (doc) {  
    doc.transact(apply, opts?.origin ?? MAINT_ORIGIN);
  } else {
    apply();
  }
};

/** 真正清理：仅在“受信任时钟 + 过期 TTL + 不在 order 中”的条件下，从 map & meta 移除 */
export const vacuumNotebook = (
  nb: YNotebook,
  ttlMs = 30 * 24 * 3600 * 1000,
  opts?: {
    clock?: ClockSource;
    now?: number;
    nowTrusted?: boolean;
    maxFutureSkewMs?: number;
  }
) => {
  const t = tombstonesMap(nb);
  const tm = tombstoneMetaMap(nb);
  const map = getCellMap(nb);

  const clock = opts?.clock;
  const nowValue = opts?.now ?? (clock ? clock.now() : systemClock.now());
  const nowTrusted =
    opts?.nowTrusted ?? (opts?.now != null ? true : clock?.trusted ?? false);
  const maxFutureSkew = opts?.maxFutureSkewMs ?? DEFAULT_FUTURE_SKEW_MS;
  const doc = (nb as any).doc as Y.Doc | undefined;

  const sweep = () => {
    /**
     * 如果在 t.forEach 内多次获取 Y.Array 状态或 tm.get() 创建新 map，依然会线性放大。
     * 
     * TODO:
     * 在长文档清理时可引入批量清理策略；
     * 或提供可中断式 vacuum（例如基于 max batch）。
     */
    const orderIds = new Set(getOrder(nb).toArray());
    t.forEach((flag, id) => {
      if (!flag) return;
      const metaSnapshot = readTombstoneMetaEntry(tm.get(id));
      const { deletedAt, clock: clk } = metaSnapshot;
      if (
        typeof deletedAt !== "number" ||
        Number.isNaN(deletedAt) ||
        deletedAt <= 0
      )
        return;

      const tsTrusted = clk === "trusted";
      if (tsTrusted && !nowTrusted) return;
      if (!tsTrusted) return;
      if (deletedAt - nowValue > maxFutureSkew) return;
      if (nowValue - deletedAt < ttlMs) return;

      // 仅清理不在 order 中的实体；若仍在 order 中，则视为“未被软删或已恢复”
      if (orderIds.has(id)) return;

      // 真正删除实体与 meta
      map.delete(id);
      tm.delete(id);
      t.delete(id);
    });
  };

  if (doc) {
    doc.transact(sweep, VACUUM_ORIGIN);
  } else {
    sweep();
  }
};

// ------------------------------
// Undo / Redo
// ------------------------------
/**
 * 仅追踪用户动作：order（顺序变更）与 cellMap（内容变更）
 * 注意：VACUUM/MAINT 等维护操作使用独立 origin，不纳入撤销栈
 * 
 * @mark 单次 doc.transact 里混合的结构与内容修改都会被压入同一条 undo 记录
 * 在复杂编辑（用户编辑 cell 内容 → 调整顺序 → 再编辑另一个 cell）时，undo 逻辑可能不符合用户期望？如果出现该问题，请注意该 UndoManager
 */
export const createNotebookUndoManager = (
  nb: YNotebook,
  opts?: { captureTimeout?: number; trackedOrigins?: Set<any> }
) => {
  const scopes: any[] = [];
  const order = nb.get(NB_CELL_ORDER) as Y.Array<string>;
  const cellMap = nb.get(NB_CELL_MAP) as Y.Map<YCell>;
  if (order) scopes.push(order);
  if (cellMap) scopes.push(cellMap);

  const tomb = nb.get(NB_TOMBSTONES) as Y.Map<boolean> | undefined;
  const tombMeta = nb.get(NB_TOMBSTONE_META) as TombstoneMetaMap | undefined;
  if (tomb) scopes.push(tomb);
  if (tombMeta) scopes.push(tombMeta);

  // 也可按需加入 metadata 等结构（通常不建议进入撤销栈）
  // const meta = nb.get(NB_METADATA) as Y.Map<any>;

  return new Y.UndoManager(scopes, {
    captureTimeout: opts?.captureTimeout ?? 500,
    trackedOrigins: opts?.trackedOrigins ?? new Set([USER_ACTION_ORIGIN]),
  } as any);
};

// ------------------------------
// Validation
// ------------------------------
export interface ValidationIssue {
  path: string;
  level: "error" | "warning";
  message: string;
}

/** 基本一致性校验：id 唯一性、顺序引用完整性、tombstone 合法性 */
export const validateNotebook = (nb: YNotebook): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];

  const order = getOrder(nb).toArray();
  const map = getCellMap(nb);
  const tomb = nb.get(NB_TOMBSTONES) as Y.Map<boolean> | undefined;
  const tombSet = new Set<string>();
  tomb?.forEach((flag, id) => {
    if (flag) tombSet.add(id);
  });

  // 1) order 中的 id 必须存在于 map，且不重复
  const seenOrder = new Map<string, number>();
  order.forEach((id, idx) => {
    if (typeof id !== "string" || id.length === 0) {
      issues.push({
        path: `order[${idx}]`,
        level: "error",
        message: `Invalid cell id at order[${idx}]`,
      });
      return;
    }
    const dup = seenOrder.get(id);
    if (dup !== undefined) {
      issues.push({
        path: `order[${idx}]`,
        level: "error",
        message: `Duplicate cell id "${id}" also present at order[${dup}]`,
      });
    } else {
      seenOrder.set(id, idx);
    }
    if (!map.has(id)) {
      issues.push({
        path: `order[${idx}]`,
        level: "error",
        message: `Cell id "${id}" referenced by order but missing in cellMap`,
      });
    }
    if (tombSet.has(id)) {
      issues.push({
        path: `order[${idx}]`,
        level: "warning",
        message: `Cell id "${id}" appears in order but is marked tombstoned`,
      });
    }
  });

  const orderSet = new Set<string>(order.filter((id): id is string => typeof id === "string"));

  // 2) map 中的 id 若未出现在 order，说明它是孤立实体（可能是 tombstone 残留或待恢复）
  map.forEach((cell, id) => {
    if (!orderSet.has(id)) {
      issues.push({
        path: `cellMap.${id}`,
        level: "warning",
        message: `Cell id "${id}" exists in cellMap but not referenced by order`,
      });
    }
    const kind = cell?.get(CELL_KIND);
    if (!kind) {
      issues.push({
        path: `cellMap.${id}`,
        level: "error",
        message: `Missing cell kind for "${id}"`,
      });
    }
    const embeddedId = cell?.get(CELL_ID);
    if (embeddedId !== undefined && embeddedId !== id) {
      issues.push({
        path: `cellMap.${id}`,
        level: "warning",
        message: `cellMap key "${id}" mismatches embedded id "${embeddedId}"`,
      });
    }
  });

  // 3) Tombstone 合法性
  const tm = nb.get(NB_TOMBSTONE_META) as TombstoneMetaMap | undefined;
  tm?.forEach((meta, id) => {
    const deletedAt = meta?.get("deletedAt");
    if (
      deletedAt != null &&
      (typeof deletedAt !== "number" || Number.isNaN(deletedAt))
    ) {
      issues.push({
        path: `tombstoneMeta.${id}`,
        level: "warning",
        message: `Invalid deletedAt for "${id}"`,
      });
    }
    const clock = meta?.get("clock");
    if (clock != null && !isValidTombstoneClock(clock)) {
      issues.push({
        path: `tombstoneMeta.${id}`,
        level: "warning",
        message: `Invalid clock tag for "${id}"`,
      });
    }
  });

  tomb?.forEach((flag, id) => {
    if (!flag) return;
    if (!map.has(id)) {
      issues.push({
        path: `tombstones.${id}`,
        level: "warning",
        message: `Tombstone exists for "${id}" but cellMap no longer has the entity`,
      });
    }
  });

  return issues;
};

// ------------------------------
// Reconciliation (auto-repair)
// ------------------------------
export interface ReconcileOptions {
  /** Append orphan cells (present in map, missing in order) to the end */
  appendOrphans?: boolean;
  /** Sort appended orphans by id (stable across peers) */
  sortOrphansById?: boolean;
  /** Drop tombstoned ids from order */
  dropTombstonedFromOrder?: boolean;
  /** Drop invalid/non-string ids and ids missing in map from order */
  dropInvalidOrderEntries?: boolean;
}

export interface ReconcileReport {
  changed: boolean;
  previousOrderLength: number;
  finalOrderLength: number;
  removedMissingFromMap: string[];
  removedTombstoned: string[];
  removedDuplicates: string[];
  removedInvalid: string[];
  appendedOrphans: string[];
}

/**
 * 尝试在本地自动修复 order / cellMap 的不一致：
 * - 去除 order 中重复、无效、缺失于 map 的 id；
 * - 默认移除 order 中的 tombstoned id；
 * - 将 map 中未被引用（非 tombstone）的实体按 id 排序后追加到末尾（可配置）。
 * 
 * 所有更改封装在一次事务中（MAINT_ORIGIN），避免进入撤销栈。
 */
export const reconcileNotebook = (
  nb: YNotebook,
  opts?: ReconcileOptions
): ReconcileReport => {
  const options: Required<ReconcileOptions> = {
    appendOrphans: opts?.appendOrphans ?? true,
    sortOrphansById: opts?.sortOrphansById ?? true,
    dropTombstonedFromOrder: opts?.dropTombstonedFromOrder ?? true,
    dropInvalidOrderEntries: opts?.dropInvalidOrderEntries ?? true,
  };

  const order = getOrder(nb);
  const map = getCellMap(nb);
  const tomb = nb.get(NB_TOMBSTONES) as Y.Map<boolean> | undefined;
  const tombSet = new Set<string>();
  tomb?.forEach((flag, id) => {
    if (flag) tombSet.add(id);
  });

  const before = order.toArray();
  const seen = new Set<string>();

  const removedMissingFromMap: string[] = [];
  const removedTombstoned: string[] = [];
  const removedDuplicates: string[] = [];
  const removedInvalid: string[] = [];
  const kept: string[] = [];

  // 过滤并去重现有 order
  for (let i = 0; i < before.length; i += 1) {
    const raw = before[i];
    // 永远过滤掉非字符串，避免向 Y.Array<string> 插入时出错
    if (typeof raw !== "string") {
      // 记录为 invalid（即使 dropInvalidOrderEntries=false 也不保留）
      removedInvalid.push(String(raw));
      continue;
    }
    // 空字符串作为一种“无效但可选保留”的场景
    if (raw.length === 0) {
      if (options.dropInvalidOrderEntries) removedInvalid.push(raw);
      else kept.push(raw);
      continue;
    }

    if (seen.has(raw)) {
      removedDuplicates.push(raw);
      continue;
    }

    if (!map.has(raw)) {
      if (options.dropInvalidOrderEntries) removedMissingFromMap.push(raw);
      else kept.push(raw);
      continue;
    }

    if (options.dropTombstonedFromOrder && tombSet.has(raw)) {
      removedTombstoned.push(raw);
      continue;
    }

    seen.add(raw);
    kept.push(raw);
  }

  // 计算并追加 orphan ids（存在于 map，但未在 kept 中，且非 tombstone）
  const keptSet = new Set<string>(kept);
  const orphans: string[] = [];
  if (options.appendOrphans) {
    map.forEach((_cell, id) => {
      if (!keptSet.has(id) && !tombSet.has(id)) orphans.push(id);
    });
    if (options.sortOrphansById) orphans.sort();
  }

  const next = kept.concat(orphans);
  const changed =
    next.length !== before.length ||
    next.some((v, idx) => v !== before[idx]);

  if (changed) {
    const doc = nb.doc as Y.Doc | undefined;
    const apply = () => {
      const len = order.length;
      if (len > 0) order.delete(0, len);
      if (next.length > 0) order.insert(0, next);
    };
    if (doc) doc.transact(apply, MAINT_ORIGIN);
    else apply();
  }

  return {
    changed,
    previousOrderLength: before.length,
    finalOrderLength: next.length,
    removedMissingFromMap,
    removedTombstoned,
    removedDuplicates,
    removedInvalid,
    appendedOrphans: orphans,
  };
};

// ------------------------------
// Bootstrap
// ------------------------------
/** 最小化引导：不做版本迁移；仅建立结构并返回 root */
export const bootstrapDoc = (doc: Y.Doc, init?: Partial<NotebookModel>) => {
  const root = ensureNotebookInDoc(doc, init);
  return root;
};


// ------------------------------
// Schema Migration Framework
// ------------------------------

export interface NotebookMigrationContext {
  doc: Y.Doc;
  root: Y.Map<any>;
  fromVersion: number;
  toVersion: number;
  origin: symbol;
  log: (msg: string) => void;
}

/** 单个迁移器的签名 */
export type NotebookMigration = (ctx: NotebookMigrationContext) => void;

/** 全局迁移注册表 */
const MIGRATION_REGISTRY = new Map<number, NotebookMigration>();

/** 注册迁移器（vX -> vY） */
export const registerNotebookMigration = (
  fromVersion: number,
  fn: NotebookMigration
) => {
  if (MIGRATION_REGISTRY.has(fromVersion)) {
    throw new Error(`Migration from version ${fromVersion} already registered`);
  }
  MIGRATION_REGISTRY.set(fromVersion, fn);
};

/**
 * 自动迁移 Notebook Schema 到最新版本。
 * 若不存在 version 字段，则视为 FIRST_SCHEMA_VERSION。
 * 
 * ```ts
 * const doc = new Y.Doc();
 * const nb = bootstrapDoc(doc);
 * migrateNotebookSchema(doc, { log: console.log });
 * ```
 */
export const migrateNotebookSchema = (
  doc: Y.Doc,
  opts?: {
    log?: (msg: string) => void;
    /** Feature flag: 迁移完成后（或版本已最新时）自动执行一次 reconcile */
    autoReconcile?: boolean;
    /** 传入给 reconcileNotebook 的细化选项 */
    reconcile?: ReconcileOptions;
  }
): number => {
  const log = opts?.log ?? console.info;

  const root = getNotebookRoot(doc);
  const meta = ensureSchemaMeta(root);
  const currentVersion =
    typeof meta.get("version") === "number"
      ? meta.get("version")
      : FIRST_SCHEMA_VERSION;

  if (currentVersion === SCHEMA_VERSION) {
    log(`[migrate] Schema already up-to-date (v${SCHEMA_VERSION}).`);
    if (opts?.autoReconcile) {
      const report = reconcileNotebook(root, opts.reconcile);
      if (report.changed) {
        log(
          `[migrate] Auto-reconcile applied: order ${report.previousOrderLength} → ${report.finalOrderLength}, appended ${report.appendedOrphans.length}, removed dup=${report.removedDuplicates.length}, missing=${report.removedMissingFromMap.length}, tomb=${report.removedTombstoned.length}, invalid=${report.removedInvalid.length}`
        );
      } else {
        log(`[migrate] Auto-reconcile found no changes.`);
      }
      const issues = validateNotebook(root);
      if (issues.length > 0) {
        log(`[migrate] Validation after reconcile: ${issues.length} issues.`);
        issues.forEach((i) => log(`  [${i.level}] ${i.path}: ${i.message}`));
      }
    }
    return currentVersion;
  }

  if (currentVersion > SCHEMA_VERSION) {
    log(
      `[migrate] Warning: document schema (v${currentVersion}) is newer than current runtime (v${SCHEMA_VERSION}).`
    );
    return currentVersion;
  }

  let workingVersion = currentVersion;
  while (workingVersion < SCHEMA_VERSION) {
    const migrator = MIGRATION_REGISTRY.get(workingVersion);
    if (!migrator) {
      log(
        `[migrate] No migration path from v${workingVersion} → v${SCHEMA_VERSION}.`
      );
      break;
    }

    const targetVersion = workingVersion + 1;
    log(`[migrate] Applying migration v${workingVersion} → v${targetVersion} ...`);

    doc.transact(() => {
      // 再次核对版本，尽量在并发场景下避免重复执行迁移体
      const liveVersion = typeof meta.get("version") === "number" ? (meta.get("version") as number) : FIRST_SCHEMA_VERSION;
      if (liveVersion !== workingVersion) {
        log(
          `[migrate] Skip step v${workingVersion} → v${targetVersion} due to concurrent advance to v${liveVersion}.`
        );
        return;
      }

      migrator({
        doc,
        root,
        fromVersion: workingVersion,
        toVersion: targetVersion,
        origin: MAINT_ORIGIN,
        log,
      });
      meta.set("version", targetVersion);
    }, MAINT_ORIGIN);

    workingVersion = targetVersion;
  }

  if (workingVersion === SCHEMA_VERSION) {
    log(`[migrate] Migration complete (v${SCHEMA_VERSION}).`);
  } else {
    log(`[migrate] Incomplete migration (stopped at v${workingVersion}).`);
  }

  if (opts?.autoReconcile) {
    const report = reconcileNotebook(root, opts.reconcile);
    if (report.changed) {
      log(
        `[migrate] Auto-reconcile applied: order ${report.previousOrderLength} → ${report.finalOrderLength}, appended ${report.appendedOrphans.length}, removed dup=${report.removedDuplicates.length}, missing=${report.removedMissingFromMap.length}, tomb=${report.removedTombstoned.length}, invalid=${report.removedInvalid.length}`
      );
    } else {
      log(`[migrate] Auto-reconcile found no changes.`);
    }
  }

  const issues = validateNotebook(root);
  if (issues.length > 0) {
    log(`[migrate] Validation after migration${opts?.autoReconcile ? "+reconcile" : ""}: ${issues.length} issues.`);
    issues.forEach((i) => log(`  [${i.level}] ${i.path}: ${i.message}`));
  }

  return workingVersion;
};


// ------------------------------
// Example Migration v1.000.000 → v1.000.001
// ------------------------------
const migrate_v1_000_000_to_v1_000_001: NotebookMigration = (ctx) => {
  const { log } = ctx;
  log("  - Nothing to do for v1.000.000 → v1.000.001");
};

registerNotebookMigration(1_000_000, migrate_v1_000_000_to_v1_000_001);
