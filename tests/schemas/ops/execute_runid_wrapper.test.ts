import * as Y from "yjs";
import { describe, it, expect } from "vitest";
import { bootstrapDoc } from "@/yjs/schema/bootstrap";
import { startExecuteCell, applyExecuteResultForCurrentRun } from "@/yjs/schema/ops/execute";
import { getCellMap } from "@/yjs/schema/access/accessors";
import { getOutputsMap } from "@/yjs/schema/access/outputs";
import { CELL_KIND } from "@/yjs/schema/core/keys";
import type { QueryResponse } from "@/yjs/api-gen-type";

const makeCell = (): Y.Map<any> => {
  const c = new Y.Map<any>();
  c.set(CELL_KIND, "sql");
  return c;
};

describe("applyExecuteResultForCurrentRun", () => {
  it("commits using internal runId without exposing it", () => {
    const doc = new Y.Doc();
    const nb = bootstrapDoc(doc);
    const map = getCellMap(nb);
    const cellId = "c-wrap-1";
    map.set(cellId, makeCell());

    startExecuteCell(nb, cellId);
    applyExecuteResultForCurrentRun(nb, cellId, { columns: [], rows: [], rowsAffected: 5 });

    const entry = getOutputsMap(nb).get(cellId)!;
    expect(entry.get("running")).toBe(false);
    expect(entry.get("stale")).toBe(false);
    const res = entry.get("result") as QueryResponse;
    expect(res.rowsAffected).toBe(5);
    expect(entry.get("runId")).toBeUndefined();
  });
});

