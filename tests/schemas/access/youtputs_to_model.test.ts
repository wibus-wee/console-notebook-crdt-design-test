import * as Y from "yjs";
import { describe, it, expect } from "vitest";
import { bootstrapDoc } from "@/yjs/schema/bootstrap";
import { getOutputsMap } from "@/yjs/schema/access/outputs";
import { yOutputsToModel } from "@/yjs/schema/access/conversion";

describe("yOutputsToModel", () => {
  it("serializes valid outputs and omits runId", () => {
    const doc = new Y.Doc();
    const nb = bootstrapDoc(doc);

    const outputs = getOutputsMap(nb);
    const id = "c-x";
    const e = new Y.Map<any>();
    e.set("running", false);
    e.set("stale", false);
    e.set("startedAt", 1);
    e.set("completedAt", 2);
    e.set("runId", "abc"); // should be omitted in model
    e.set("result", { columns: [], rows: [], rowsAffected: 7, error: "boom" });
    outputs.set(id, e);

    const model = yOutputsToModel(nb);
    expect(model[id]).toBeTruthy();
    expect(model[id].running).toBe(false);
    expect(model[id].stale).toBe(false);
    expect(model[id].startedAt).toBe(1);
    expect(model[id].completedAt).toBe(2);
    // @ts-expect-error runId is intentionally omitted
    expect((model[id] as any).runId).toBeUndefined();
    expect(model[id].result?.rowsAffected).toBe(7);
    expect(model[id].result?.error).toBe("boom");
  });

  it("skips invalid entries", () => {
    const doc = new Y.Doc();
    const nb = bootstrapDoc(doc);
    const outputs = getOutputsMap(nb);

    outputs.set("ok", new Y.Map<any>());
    outputs.set("bad", 123 as any); // invalid, should be skipped

    const model = yOutputsToModel(nb);
    expect(model.ok).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(model, "bad")).toBe(false);
  });
});

