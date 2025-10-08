import * as Y from "yjs";
import { MAINT_ORIGIN } from "../core/origins";
import type { YNotebook } from "../core/types";
import { getCellMap, getOrder } from "../access/accessors";
import { tombstonesMap } from "../access/tombstone";

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
  const tomb = tombstonesMap(nb);
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

  const keptSet = new Set<string>(kept);
  const orphans: string[] = [];
  if (options.appendOrphans) {
    map.forEach((_cell, id) => {
      if (!keptSet.has(id) && !tombSet.has(id)) orphans.push(id);
    });
    if (options.sortOrphansById) orphans.sort();
  }

  const next = kept.concat(orphans);
  const changed = next.length !== before.length || next.some((v, idx) => v !== before[idx]);

  if (changed) {
    const doc = (nb as any).doc as Y.Doc | undefined;
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

