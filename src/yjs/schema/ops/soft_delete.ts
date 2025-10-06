import * as Y from "yjs";
import { USER_ACTION_ORIGIN } from "../core/origins";
import { WALL_CLOCK_EPOCH_FLOOR_MS, systemClock, type ClockSource } from "../core/time";
import { getOrder, getCellMap } from "../access/accessors";
import { tombstonesMap, tombstoneMetaMap, ensureTombstoneMetaEntry, type TombstoneMetaMap } from "../access/tombstone";
import type { YNotebook } from "../core/types";
import { NB_TOMBSTONES, NB_TOMBSTONE_META } from "../core/keys";

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

  const resolve = (): { ts?: number; clock?: "trusted" | "local" } => {
    const cs = opts?.clock ?? systemClock;
    const hasTs = opts?.timestamp != null;
    const ts = hasTs ? (opts!.timestamp as number) : cs.now();
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

    // 这里不调用 lockCellId，因为在 insert/create 时已确保；恢复仅操作 order + tombs
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
