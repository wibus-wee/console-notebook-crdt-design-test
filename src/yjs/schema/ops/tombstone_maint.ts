import * as Y from "yjs";
import { MAINT_ORIGIN, VACUUM_ORIGIN } from "../core/origins";
import { DEFAULT_FUTURE_SKEW_MS, WALL_CLOCK_EPOCH_FLOOR_MS } from "../core/time";
import { getOrder, getCellMap } from "../access/accessors";
import { ensureTombstoneMetaEntry, readTombstoneMetaEntry, tombstoneMetaMap, tombstonesMap } from "../access/tombstone";
import type { YNotebook } from "../core/types";
import { NB_OUTPUTS } from "../core/keys";

export interface TombstoneTimestampOptions {
  reason?: string;
  clock?: { now(): number; trusted: boolean };
  trusted?: boolean;
  origin?: symbol;
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

  const resolvedClock = opts?.trusted ?? opts?.clock?.trusted ?? true ? "trusted" : "local";
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
    clock?: { now(): number; trusted: boolean };
    now?: number;
    nowTrusted?: boolean;
    maxFutureSkewMs?: number;
  }
) => {
  const t = tombstonesMap(nb);
  const tm = tombstoneMetaMap(nb);
  const map = getCellMap(nb);

  const clock = opts?.clock;
  const nowValue = opts?.now ?? (clock ? clock.now() : Date.now());
  const nowTrusted = opts?.nowTrusted ?? (opts?.now != null ? true : clock?.trusted ?? false);
  const maxFutureSkew = opts?.maxFutureSkewMs ?? DEFAULT_FUTURE_SKEW_MS;
  const doc = nb.doc as Y.Doc | undefined;

  const sweep = () => {
    const orderIds = new Set(getOrder(nb).toArray());
    t.forEach((flag, id) => {
      if (!flag) return;
      const metaSnapshot = readTombstoneMetaEntry(tm.get(id));
      const { deletedAt, clock: clk } = metaSnapshot;
      if (typeof deletedAt !== "number" || Number.isNaN(deletedAt) || deletedAt <= 0) return;

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

      // 同步清理对应 outputs（如果存在）
      const outputs = nb.get(NB_OUTPUTS);
      outputs?.delete(id);
    });
  };

  if (doc) {
    doc.transact(sweep, VACUUM_ORIGIN);
  } else {
    sweep();
  }
};
