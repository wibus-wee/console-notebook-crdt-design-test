import * as Y from "yjs";
import { describe, it, expect } from "vitest";
import { bootstrapDoc } from "@/yjs/schema/bootstrap";
import { ensureOutputEntry } from "@/yjs/schema/access/outputs";
import { getCellMap } from "@/yjs/schema/access/accessors";
import { CELL_ID, CELL_KIND, CELL_SOURCE } from "@/yjs/schema/core/keys";

describe("auto-stale binder", () => {
  it("marks stale=true when source text changes", () => {
    const doc = new Y.Doc();
    const nb = bootstrapDoc(doc);
    const map = getCellMap(nb);

    const cellId = "c-auto-1";
    const cell = new Y.Map<any>();
    cell.set(CELL_ID, cellId);
    cell.set(CELL_KIND, "sql");
    const text = new Y.Text("select 1");
    cell.set(CELL_SOURCE, text);
    map.set(cellId, cell);

    // prepare outputs entry
    const entry = ensureOutputEntry(nb, cellId);
    expect(entry.get("stale")).toBe(false);

    // change source text -> should set stale=true
    text.insert(0, "-- ");
    expect(entry.get("stale")).toBe(true);
  });

  it("re-binds when CELL_SOURCE is replaced with a new Y.Text", () => {
    const doc = new Y.Doc();
    const nb = bootstrapDoc(doc);
    const map = getCellMap(nb);

    const cellId = "c-auto-2";
    const cell = new Y.Map<any>();
    cell.set(CELL_ID, cellId);
    cell.set(CELL_KIND, "sql");
    const text1 = new Y.Text("select 1");
    cell.set(CELL_SOURCE, text1);
    map.set(cellId, cell);

    const entry = ensureOutputEntry(nb, cellId);
    entry.set("stale", false);
    expect(entry.get("stale")).toBe(false);

    // replace source object
    const text2 = new Y.Text("select 2");
    cell.set(CELL_SOURCE, text2);

    // edit new text -> should mark stale again
    text2.insert(0, "-- ");
    expect(entry.get("stale")).toBe(true);
  });
});

