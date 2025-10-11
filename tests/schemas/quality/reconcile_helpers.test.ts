import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  mergeDeleteIndexesToRanges,
  findOrphansToAppend,
  resolveReconcileOptions,
  type ReconcileOptions,
} from "@/yjs/schema/quality/reconcile";

describe("reconcile helpers", () => {
  it("mergeDeleteIndexesToRanges compresses contiguous indexes", () => {
    expect(mergeDeleteIndexesToRanges([])).toEqual([]);
    expect(mergeDeleteIndexesToRanges([1, 2, 3])).toEqual([{ start: 1, len: 3 }]);
    expect(mergeDeleteIndexesToRanges([0, 2, 3, 5])).toEqual([
      { start: 0, len: 1 },
      { start: 2, len: 2 },
      { start: 5, len: 1 },
    ]);
  });

  it("findOrphansToAppend respects kept and tombstone sets", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<any>("m");
    map.set("a", new Y.Map());
    map.set("b", new Y.Map());
    map.set("c", new Y.Map());

    const kept = new Set(["a"]);
    const tomb = new Set(["b"]);
    const options = resolveReconcileOptions({ appendOrphans: true });

    const res = findOrphansToAppend(map, kept, tomb, options);
    expect(res).toEqual(["c"]);

    const opts2: Required<ReconcileOptions> = {
      ...options,
      appendOrphans: false,
    };
    expect(findOrphansToAppend(map, kept, tomb, opts2)).toEqual([]);
  });
});
