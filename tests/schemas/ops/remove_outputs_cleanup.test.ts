import * as Y from "yjs";
import { describe, it, expect } from "vitest";
import { bootstrapDoc } from "@/yjs/schema/bootstrap";
import { getCellMap } from "@/yjs/schema/access/accessors";
import { ensureOutputEntry, getOutputsMap } from "@/yjs/schema/access/outputs";
import { removeCell } from "@/yjs/schema/ops/mutations";
import { CELL_KIND } from "@/yjs/schema/core/keys";

describe("removeCell cleans outputs", () => {
  it("removes corresponding outputs entry on hard delete", () => {
    const doc = new Y.Doc();
    const nb = bootstrapDoc(doc);

    const id = "cell-x";
    const cell = new Y.Map<any>();
    cell.set(CELL_KIND, "sql");
    const map = getCellMap(nb);
    map.set(id, cell);

    const entry = ensureOutputEntry(nb, id);
    entry.set("running", true);

    const outputsBefore = getOutputsMap(nb);
    expect(outputsBefore.has(id)).toBe(true);

    removeCell(nb, id);

    const outputsAfter = getOutputsMap(nb);
    expect(outputsAfter.has(id)).toBe(false);
  });
});

