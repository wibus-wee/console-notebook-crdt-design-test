import * as Y from "yjs";
import { describe, it, expect } from "vitest";
import { bootstrapDoc } from "@/yjs/schema/bootstrap";
import { startExecuteCell, applyExecuteResult } from "@/yjs/schema/ops/execute";
import { getOutputsMap } from "@/yjs/schema/access/outputs";
import { getCellMap } from "@/yjs/schema/access/accessors";
import { CELL_KIND } from "@/yjs/schema/core/keys";

const makeCell = (): Y.Map<any> => {
  const c = new Y.Map<any>();
  c.set(CELL_KIND, "sql");
  return c;
};

describe("execute runId guard", () => {
  it("should only apply result when expectedRunId matches", () => {
    const doc = new Y.Doc();
    const nb = bootstrapDoc(doc);

    // prepare cell
    const map = getCellMap(nb);
    const cellId = "cell-1";
    map.set(cellId, makeCell());

    // start execution to create entry + runId
    startExecuteCell(nb, cellId);
    const outputs = getOutputsMap(nb);
    const entry = outputs.get(cellId)!;
    const runId = entry.get("runId");
    expect(typeof runId).toBe("string");

    // mismatched runId should NOT land
    applyExecuteResult(nb, cellId, { columns: [], rows: [], rowsAffected: 0 }, {
      expectedRunId: "not-this-run",
    });
    expect(entry.get("result")).toBeUndefined();
    expect(entry.get("running")).toBe(true); // still running
    expect(entry.get("runId")).toBe(runId);

    // matching runId should land and clear runId by default
    applyExecuteResult(nb, cellId, { columns: [], rows: [], rowsAffected: 0 }, {
      expectedRunId: runId,
    });
    expect(entry.get("running")).toBe(false);
    expect(entry.get("stale")).toBe(false);
    expect(typeof entry.get("completedAt")).toBe("number");
    expect(entry.get("result")).toBeTruthy();
    expect(entry.get("runId")).toBeUndefined(); // cleared

    // late result with old runId should be ignored
    applyExecuteResult(nb, cellId, { columns: [], rows: [], rowsAffected: 123 }, {
      expectedRunId: runId,
    });
    expect(entry.get("rowsAffected")).toBeUndefined(); // not directly stored; ensure result unchanged
    const res = entry.get("result");
    expect(res.rowsAffected).toBe(0);
  });

  it("should not create entry when absent and ignore result", () => {
    const doc = new Y.Doc();
    const nb = bootstrapDoc(doc);
    const map = getCellMap(nb);
    const cellId = "cell-2";
    map.set(cellId, makeCell());

    // apply result without a startExecuteCell -> no entry
    applyExecuteResult(nb, cellId, { columns: [], rows: [], rowsAffected: 1 });
    const outputs = getOutputsMap(nb);
    expect(outputs.has(cellId)).toBe(false);
  });

  it("should allow ignoreRunId to force write", () => {
    const doc = new Y.Doc();
    const nb = bootstrapDoc(doc);
    const map = getCellMap(nb);
    const cellId = "cell-3";
    map.set(cellId, makeCell());

    startExecuteCell(nb, cellId);
    const outputs = getOutputsMap(nb);
    const entry = outputs.get(cellId)!;
    const originalRunId = entry.get("runId");

    // Force write with ignoreRunId
    applyExecuteResult(nb, cellId, { columns: [], rows: [], rowsAffected: 9 }, {
      expectedRunId: "whatever",
      ignoreRunId: true,
    });
    const res = entry.get("result");
    expect(res.rowsAffected).toBe(9);
    expect(entry.get("running")).toBe(false);
    // default clearRunId removes runId even when forced
    expect(entry.get("runId")).toBeUndefined();

    // subsequent late write should be ignored without ignoreRunId
    applyExecuteResult(nb, cellId, { columns: [], rows: [], rowsAffected: 42 }, {
      expectedRunId: originalRunId,
    });
    const res2 = entry.get("result");
    expect(res2.rowsAffected).toBe(9);
  });
});

