import * as Y from "yjs";
import { bootstrapDoc } from "@/yjs/schema/bootstrap";
import { softDeleteCell } from "@/yjs/schema/ops/soft_delete";
import { setTombstoneTimestamp, vacuumNotebook } from "@/yjs/schema/ops/tombstone_maint";
import { NB_OUTPUTS } from "@/yjs/schema/core/keys";
import { describe, it, expect } from "vitest";

describe("vacuumNotebook - outputs integration", () => {
  it("should remove outputs when tombstone is vacuumed", () => {
    const doc = new Y.Doc();
    const nb = bootstrapDoc(doc);
    const cellId = "c1";

    // create cell
    const map = nb.get("cellMap");
    map.set(cellId, new Y.Map());

    // add outputs
    const outputs = new Y.Map();
    const outEntry = new Y.Map();
    outputs.set(cellId, outEntry);
    nb.set(NB_OUTPUTS, outputs);

    // soft delete
    softDeleteCell(nb, cellId);
    setTombstoneTimestamp(nb, cellId, Date.now() - 90 * 24 * 3600 * 1000); // 90天前
    vacuumNotebook(nb, 30 * 24 * 3600 * 1000, { nowTrusted: true, now: Date.now() });

    const outAfter = nb.get(NB_OUTPUTS);
    expect(outAfter.size).toBe(0); // cleaned
  });
});
