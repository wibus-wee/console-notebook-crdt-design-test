import * as Y from "yjs";
import { USER_ACTION_ORIGIN } from "../core/origins";
import { CELL_ID, NB_TOMBSTONES, NB_TOMBSTONE_META } from "../core/keys";
import type { YCell, YNotebook } from "../core/types";
import { getCellMap, getOrder } from "../access/accessors";
import { lockCellId } from "../access/cells";

/** 在指定位置插入 cell（省略 index 则 append） */
export const insertCell = (
  nb: YNotebook,
  cell: YCell,
  index?: number,
  origin: symbol = USER_ACTION_ORIGIN
) => {
  const doc = nb.doc as Y.Doc | undefined;
  const id = cell.get(CELL_ID) as string;
  if (typeof id !== "string" || !id) throw new Error("Cell must have a valid id");

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
    const tm = nb.get(NB_TOMBSTONE_META) as Y.Map<unknown> | undefined;
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
