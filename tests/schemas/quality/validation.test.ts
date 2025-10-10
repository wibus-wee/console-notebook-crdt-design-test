import * as Y from "yjs";
import { bootstrapDoc } from "@/yjs/schema/bootstrap";
import { validateNotebook } from "@/yjs/schema/quality/validation";
import { CELL_KIND, NB_OUTPUTS } from "@/yjs/schema/core/keys";
import { describe, it, expect } from "vitest";
import { ulid } from "ulid";

describe("validateNotebook - outputs", () => {
  it("should detect invalid structure and orphan outputs", () => {
    const doc = new Y.Doc();
    const nb = bootstrapDoc(doc);
    const outputs = new Y.Map();
    nb.set(NB_OUTPUTS, outputs);

    // 非 Y.Map
    outputs.set("invalid1", 123);

    // 孤立 cell output
    outputs.set("ghost", new Y.Map());
    (outputs.get("ghost") as Y.Map<any>).set("running", true);

    const issues = validateNotebook(nb);
    const kinds = issues.map((i) => i.message);

    expect(kinds.some((m) => m.includes("not a Y.Map"))).toBe(true);
    expect(kinds.some((m) => m.includes("Output exists for"))).toBe(true);
  });

  it("should pass valid output structure", () => {
    const doc = new Y.Doc();
    const nb = bootstrapDoc(doc);
    const map = nb.get("cellMap");
    const order = nb.get("order");
    const outputs = new Y.Map();
    nb.set(NB_OUTPUTS, outputs);

    const cellId = ulid();
    const cell = new Y.Map();
    cell.set(CELL_KIND, "sql");
    map.set(cellId, cell);
    order.push([cellId]);

    const entry = new Y.Map();
    entry.set("running", false);
    entry.set("result", { columns: [], rows: [], rowsAffected: 0 });
    outputs.set(cellId, entry);

    const issues = validateNotebook(nb);
    expect(issues.length).toBe(0);
  });
});
