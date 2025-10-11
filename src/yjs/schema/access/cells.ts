import * as Y from "yjs";
import { ulid } from "ulid";
import {
  CELL_EXEC_BY,
  CELL_FINGERPRINT,
  CELL_ID,
  CELL_KIND,
  CELL_META,
  CELL_SOURCE,
} from "../core/keys";
import { type CellKind, type CellModel, DEFAULT_CELL_METADATA, type YCell } from "../core/types";
import { CELL_ID_GUARD_ORIGIN } from "../core/origins";
import { withTransactOptional } from "../core/transaction";

const CELL_ID_REGISTRY: WeakMap<YCell, string> = new WeakMap();

/** 保护 Cell id 不被后续变更（CRDT 合并后仍保持稳定主键） */
export const lockCellId = (cell: YCell) => {
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
    const reset = () => cell.set(CELL_ID, locked);
    withTransactOptional(cell, reset, CELL_ID_GUARD_ORIGIN);
  });
};

export const createCell = (init: Partial<CellModel> & { kind: CellKind }): YCell => {
  if (!init?.kind) throw new Error("Cell kind required");
  const c = new Y.Map<any>();
  c.set(CELL_ID, init.id ?? ulid());
  c.set(CELL_KIND, init.kind);

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

