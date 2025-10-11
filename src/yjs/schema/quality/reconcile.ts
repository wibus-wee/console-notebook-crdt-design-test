import * as Y from "yjs";
import { MAINT_ORIGIN } from "../core/origins";
import type { YNotebook } from "../core/types";
import { getCellMap, getOrder } from "../access/accessors";
import { tombstonesMap } from "../access/tombstone";
import { validateNotebook, type ValidationIssue } from "./validation";
import { withTransactOptional } from "../core/transaction";

/** Delete range in the order array */
export interface DeleteRange {
  start: number;
  len: number;
}

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

/**
 * Normalize reconcile options with defaults.
 */
export const resolveReconcileOptions = (
  opts?: ReconcileOptions
): Required<ReconcileOptions> => ({
  appendOrphans: opts?.appendOrphans ?? true,
  sortOrphansById: opts?.sortOrphansById ?? true,
  dropTombstonedFromOrder: opts?.dropTombstonedFromOrder ?? true,
  dropInvalidOrderEntries: opts?.dropInvalidOrderEntries ?? true,
  validateAfter: opts?.validateAfter ?? false,
});

/**
 * Build a set of tombstoned ids from the tombstone map.
 */
export const buildTombstoneSet = (tomb?: Y.Map<boolean>): Set<string> => {
  const tombSet = new Set<string>();
  tomb?.forEach((flag, id) => {
    if (flag) tombSet.add(id);
  });
  return tombSet;
};

export interface ClassificationResult {
  kept: string[];
  indexesToDelete: number[];
  removedMissingFromMap: string[];
  removedTombstoned: string[];
  removedDuplicates: string[];
  removedInvalid: string[];
}

/**
 * Classify the current order entries, producing kept ids and the delete index list,
 * while recording removal reasons for reporting.
 */
export const classifyOrderEntries = (
  orderSnapshot: any[],
  options: Required<ReconcileOptions>,
  mapHas: (id: string) => boolean,
  tombSet: Set<string>
): ClassificationResult => {
  const seen = new Set<string>();
  const removedMissingFromMap: string[] = [];
  const removedTombstoned: string[] = [];
  const removedDuplicates: string[] = [];
  const removedInvalid: string[] = [];
  const kept: string[] = [];
  const indexesToDelete: number[] = [];

  for (let i = 0; i < orderSnapshot.length; i += 1) {
    const raw = orderSnapshot[i] as any;

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

  return {
    kept,
    indexesToDelete,
    removedMissingFromMap,
    removedTombstoned,
    removedDuplicates,
    removedInvalid,
  };
};

/**
 * Collect orphan ids (present in map but not in kept and not tombstoned).
 */
export const findOrphansToAppend = (
  map: Y.Map<any>,
  keptSet: Set<string>,
  tombSet: Set<string>,
  options: Required<ReconcileOptions>
): string[] => {
  const orphans: string[] = [];
  if (!options.appendOrphans) return orphans;
  map.forEach((_cell, id) => {
    if (!keptSet.has(id) && !tombSet.has(id)) orphans.push(id);
  });
  if (options.sortOrphansById) orphans.sort();
  return orphans;
};

/**
 * Compress a sorted list of indexes to delete into contiguous ranges.
 */
export const mergeDeleteIndexesToRanges = (indexesToDelete: number[]): DeleteRange[] => {
  if (indexesToDelete.length === 0) return [];
  const idxs = [...indexesToDelete].sort((a, b) => a - b);
  const ranges: DeleteRange[] = [];
  let rangeStart: number | null = null;
  let prev: number | null = null;
  for (const idx of idxs) {
    if (rangeStart == null) {
      rangeStart = idx;
      prev = idx;
    } else if (prev != null && idx === prev + 1) {
      prev = idx;
    } else {
      ranges.push({ start: rangeStart, len: prev! - rangeStart + 1 });
      rangeStart = idx;
      prev = idx;
    }
  }
  if (rangeStart != null) ranges.push({ start: rangeStart, len: prev! - rangeStart + 1 });
  return ranges;
};

/**
 * Apply minimal patch to the Y.Array order: delete ranges and append orphans.
 */
export const applyOrderPatch = (
  nb: YNotebook,
  order: Y.Array<string>,
  deleteRanges: DeleteRange[],
  orphans: string[]
) => {
  const willDelete = deleteRanges.length > 0;
  const willAppend = orphans.length > 0;
  if (!willDelete && !willAppend) return;

  const apply = () => {
    // apply deletions from end to start to keep indices valid
    for (let i = deleteRanges.length - 1; i >= 0; i -= 1) {
      const { start, len } = deleteRanges[i]!;
      if (len > 0) order.delete(start, len);
    }
    if (willAppend) order.push(orphans);
  };
  withTransactOptional(nb, apply, MAINT_ORIGIN);
};

export const reconcileNotebook = (
  nb: YNotebook,
  opts?: ReconcileOptions
): ReconcileReport => {
  const options = resolveReconcileOptions(opts);

  const order = getOrder(nb);
  const map = getCellMap(nb);
  const tomb = tombstonesMap(nb);
  const tombSet = buildTombstoneSet(tomb);

  // snapshot for computation only (we will apply minimal patch)
  const before = order.toArray();
  const classification = classifyOrderEntries(before, options, (id) => map.has(id), tombSet);

  const keptSet = new Set<string>(classification.kept);
  const orphans = findOrphansToAppend(map, keptSet, tombSet, options);

  const deleteRanges = mergeDeleteIndexesToRanges(classification.indexesToDelete);
  const changed = deleteRanges.length > 0 || orphans.length > 0;

  if (changed) {
    applyOrderPatch(nb, order, deleteRanges, orphans);
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
    removedMissingFromMap: classification.removedMissingFromMap,
    removedTombstoned: classification.removedTombstoned,
    removedDuplicates: classification.removedDuplicates,
    removedInvalid: classification.removedInvalid,
    appendedOrphans: orphans,
    patchStats,
    validationIssues,
  };
};
