import * as Y from "yjs";
import { describe, it, expect } from "vitest";
import { bootstrapDoc } from "@/yjs/schema/bootstrap";
import { ensureOutputEntry } from "@/yjs/schema/access/outputs";
import { getCellMap } from "@/yjs/schema/access/accessors";
import { CELL_ID, CELL_KIND, CELL_SOURCE } from "@/yjs/schema/core/keys";

describe("auto-stale unbind on source replace", () => {
  it("does not react to edits of old text after replacement", () => {
    const doc = new Y.Doc();
    const nb = bootstrapDoc(doc);
    const map = getCellMap(nb);

    const cellId = "c-unbind-1";
    const cell = new Y.Map<any>();
    cell.set(CELL_ID, cellId);
    cell.set(CELL_KIND, "sql");
    const text1 = new Y.Text("select 1");
    cell.set(CELL_SOURCE, text1);
    map.set(cellId, cell);

    const entry = ensureOutputEntry(nb, cellId);
    entry.set("stale", false);

    // replace with new text
    const text2 = new Y.Text("select 2");
    cell.set(CELL_SOURCE, text2);

    // reset stale and edit old text -> should NOT mark stale
    entry.set("stale", false);
    text1.insert(0, "-- old ");
    expect(entry.get("stale")).toBe(false);

    // editing new text should mark stale
    text2.insert(0, "-- new ");
    expect(entry.get("stale")).toBe(true);
  });
});

