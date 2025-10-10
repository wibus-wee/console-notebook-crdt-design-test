import * as Y from "yjs";
import { bootstrapDoc } from "@/yjs/schema/bootstrap";
import { reconcileOutputs } from "@/yjs/schema/quality/reconcile_outputs";
import { NB_OUTPUTS } from "@/yjs/schema/core/keys";
import { describe, expect, it } from "vitest";

describe("reconcileOutputs", () => {
  it("should remove orphan and invalid outputs", () => {
    const doc = new Y.Doc();
    const nb = bootstrapDoc(doc);
    const outputs = new Y.Map();
    nb.set(NB_OUTPUTS, outputs);

    outputs.set("ghost", new Y.Map()); // orphan
    outputs.set("bad", 123); // invalid

    const report = reconcileOutputs(nb);
    expect(report.changed).toBe(true);
    expect(report.removedOrphans).toContain("ghost");
    expect(report.removedInvalid).toContain("bad");
  });

  it("should skip when nothing invalid", () => {
    const doc = new Y.Doc();
    const nb = bootstrapDoc(doc);
    const map = nb.get("cellMap");
    const outputs = new Y.Map();
    nb.set(NB_OUTPUTS, outputs);

    const cellId = "ok";
    map.set(cellId, new Y.Map());
    outputs.set(cellId, new Y.Map());

    const report = reconcileOutputs(nb);
    expect(report.changed).toBe(false);
    expect(report.finalCount).toBe(1);
  });
});
