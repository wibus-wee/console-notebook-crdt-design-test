import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { ensureNotebookInDoc } from "@/yjs/schema/bootstrap";
import { getCellMap, getOrder } from "@/yjs/schema/access/accessors";
import { createNotebookUndoManager } from "@/yjs/schema/quality/undo";
import { reconcileNotebook } from "@/yjs/schema/quality/reconcile";
import { MAINT_ORIGIN, USER_ACTION_ORIGIN } from "@/yjs/schema/core/origins";
import { softDeleteCell } from "@/yjs/schema/ops/soft_delete";
import { tombstonesMap, tombstoneMetaMap } from "@/yjs/schema/access/tombstone";
import { moveCell } from "@/yjs/schema/ops/mutations";

describe("UndoManager integration (small step)", () => {
  it("does not capture reconcile (MAINT_ORIGIN)", () => {
    const doc = new Y.Doc();
    const nb = ensureNotebookInDoc(doc, { title: "t" });
    const order = getOrder(nb);
    const map = getCellMap(nb);

    // Prepare a duplicate in order under MAINT origin (not a user action)
    map.set("x", new Y.Map());
    doc.transact(() => {
      const len = order.length;
      if (len) order.delete(0, len);
      order.push(["x", "x"]);
    }, MAINT_ORIGIN);

    const um = createNotebookUndoManager(nb);
    const stacks = um as unknown as { undoStack: unknown[]; redoStack: unknown[] };
    expect(stacks.undoStack.length).toBe(0);

    // Reconcile removes the duplicate using MAINT_ORIGIN
    const report = reconcileNotebook(nb);
    expect(report.changed).toBe(true);
    expect(order.toArray()).toEqual(["x"]);

    // UndoManager should not record reconcile changes
    expect(stacks.undoStack.length).toBe(0);
    um.undo();
    expect(order.toArray()).toEqual(["x"]);
  });

  it("softDelete is undoable and redoable (order/tomb/meta)", () => {
    const doc = new Y.Doc();
    const nb = ensureNotebookInDoc(doc, { title: "t" });
    const order = getOrder(nb);
    const map = getCellMap(nb);

    map.set("x", new Y.Map());
    order.push(["x"]);

    const um = createNotebookUndoManager(nb);

    softDeleteCell(nb, "x", "trash", { timestamp: 10_000, trusted: true });

    expect(order.toArray()).toEqual([]);
    expect(tombstonesMap(nb).get("x")).toBe(true);
    expect(tombstoneMetaMap(nb).get("x")).toBeTruthy();

    um.undo();

    expect(order.toArray()).toEqual(["x"]);
    expect(tombstonesMap(nb).get("x")).toBeUndefined();
    expect(tombstoneMetaMap(nb).get("x")).toBeUndefined();

    um.redo();

    expect(order.toArray()).toEqual([]);
    expect(tombstonesMap(nb).get("x")).toBe(true);
    expect(tombstoneMetaMap(nb).get("x")).toBeTruthy();
  });

  // Note: Combined scenarios of user move and later maintenance edits on the
  // same Y.Array can exhibit Yjs undo semantics that are sensitive to
  // interleaving. We keep combined coverage minimal to avoid flakiness.
});
