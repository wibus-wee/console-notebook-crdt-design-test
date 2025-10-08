import * as Y from "yjs";
import { MAINT_ORIGIN } from "../core/origins";
import type { YNotebook } from "../core/types";
import { getCellMap, getOrder } from "../access/accessors";
import { tombstonesMap } from "../access/tombstone";
import { validateNotebook, type ValidationIssue } from "./validation";

export interface ReconcileOptions {
  /** Append orphan cells (present in map, missing in order) to the end */
  appendOrphans?: boolean;
  /** Sort appended orphans by id (stable across peers) */
  sortOrphansById?: boolean;
  /** Drop tombstoned ids from order */
  dropTombstonedFromOrder?: boolean;
  /** Drop invalid/non-string ids and ids missing in map from order */
  dropInvalidOrderEntries?: boolean;
  /** Validate notebook after reconcile and include issues in the report */
  validateAfter?: boolean;
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
  /** Summary of the applied minimal-diff patch */
  patchStats: {
    deleteOps: number; // number of delete ranges applied
    deletedCount: number; // total items deleted
    appendedCount: number; // items appended at end
  };
  /** Optional validation issues when validateAfter=true */
  validationIssues?: ValidationIssue[];
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
    validateAfter: opts?.validateAfter ?? false,
  };

  const order = getOrder(nb);
  const map = getCellMap(nb);
  const tomb = tombstonesMap(nb);

  const tombSet = new Set<string>();
  tomb?.forEach((flag, id) => {
    if (flag) tombSet.add(id);
  });

  // snapshot for computation only (we will apply minimal patch)
  const before = order.toArray();
  const mapHas = (id: string) => map.has(id);

  const seen = new Set<string>();
  const removedMissingFromMap: string[] = [];
  const removedTombstoned: string[] = [];
  const removedDuplicates: string[] = [];
  const removedInvalid: string[] = [];
  const kept: string[] = [];

  // collect indexes to delete (minimal diffs)
  const indexesToDelete: number[] = [];

  for (let i = 0; i < before.length; i += 1) {
    const raw = before[i] as any;

    // Always drop non-string entries
    if (typeof raw !== "string") {
      removedInvalid.push(String(raw));
      indexesToDelete.push(i);
      continue;
    }
    // Empty string: optionally keep
    if (raw.length === 0) {
      if (options.dropInvalidOrderEntries) {
        removedInvalid.push(raw);
        indexesToDelete.push(i);
      } else {
        kept.push(raw);
      }
      continue;
    }

    if (seen.has(raw)) {
      removedDuplicates.push(raw);
      indexesToDelete.push(i);
      continue;
    }

    if (!mapHas(raw)) {
      if (options.dropInvalidOrderEntries) {
        removedMissingFromMap.push(raw);
        indexesToDelete.push(i);
      } else {
        kept.push(raw);
        seen.add(raw);
      }
      continue;
    }

    if (options.dropTombstonedFromOrder && tombSet.has(raw)) {
      removedTombstoned.push(raw);
      indexesToDelete.push(i);
      continue;
    }

    seen.add(raw);
    kept.push(raw);
  }

  // Determine orphans to append
  const keptSet = new Set<string>(kept);
  const orphans: string[] = [];
  if (options.appendOrphans) {
    map.forEach((_cell, id) => {
      if (!keptSet.has(id) && !tombSet.has(id)) orphans.push(id);
    });
    if (options.sortOrphansById) orphans.sort();
  }

  // Compress deletions into ranges (minimal number of delete ops)
  indexesToDelete.sort((a, b) => a - b);
  const deleteRanges: Array<{ start: number; len: number }> = [];
  let rangeStart: number | null = null;
  let prev: number | null = null;
  for (const idx of indexesToDelete) {
    if (rangeStart == null) {
      rangeStart = idx;
      prev = idx;
    } else if (prev != null && idx === prev + 1) {
      prev = idx;
    } else {
      deleteRanges.push({ start: rangeStart, len: (prev! - rangeStart) + 1 });
      rangeStart = idx;
      prev = idx;
    }
  }
  if (rangeStart != null) deleteRanges.push({ start: rangeStart, len: (prev! - rangeStart) + 1 });

  const willDelete = deleteRanges.length > 0;
  const willAppend = orphans.length > 0;
  const changed = willDelete || willAppend;

  if (changed) {
    const doc = (nb as any).doc as Y.Doc | undefined;
    const apply = () => {
      // apply deletions from end to start to keep indices valid
      for (let i = deleteRanges.length - 1; i >= 0; i -= 1) {
        const { start, len } = deleteRanges[i];
        if (len > 0) order.delete(start, len);
      }
      if (willAppend) order.push(orphans);
    };
    if (doc) doc.transact(apply, MAINT_ORIGIN);
    else apply();
  }

  const finalLen = changed ? order.length : before.length; // minimal overhead read

  const patchStats = {
    deleteOps: deleteRanges.length,
    deletedCount: deleteRanges.reduce((acc, r) => acc + r.len, 0),
    appendedCount: orphans.length,
  };

  const validationIssues = options.validateAfter ? validateNotebook(nb) : undefined;

  return {
    changed,
    previousOrderLength: before.length,
    finalOrderLength: finalLen,
    removedMissingFromMap,
    removedTombstoned,
    removedDuplicates,
    removedInvalid,
    appendedOrphans: orphans,
    patchStats,
    validationIssues,
  };
};
