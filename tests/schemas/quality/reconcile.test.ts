import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { reconcileNotebook, type ReconcileOptions } from "@/yjs/schema/quality/reconcile";
import { ensureNotebookInDoc } from "@/yjs/schema/bootstrap";
import { getCellMap, getOrder } from "@/yjs/schema/access/accessors";
import { tombstonesMap } from "@/yjs/schema/access/tombstone";
import { MAINT_ORIGIN } from "@/yjs/schema/core/origins";

const setup = () => {
  const doc = new Y.Doc();
  const nb = ensureNotebookInDoc(doc, { title: "t" });
  const order = getOrder(nb);
  const map = getCellMap(nb);
  return { doc, nb, order, map };
};

const setOrder = (order: Y.Array<string>, ids: any[]) => {
  const len = order.length;
  if (len) order.delete(0, len);
  (order as unknown as Y.Array<any>).insert(0, ids);
};

describe("reconcileNotebook", () => {
  it("no-op when order and map are consistent", () => {
    const { nb, order, map } = setup();
    map.set("a", new Y.Map());
    map.set("b", new Y.Map());
    order.push(["a", "b"]);

    let fired = false;
    order.observe(() => {
      fired = true;
    });

    const report = reconcileNotebook(nb);

    expect(report.changed).toBe(false);
    expect(report.previousOrderLength).toBe(2);
    expect(report.finalOrderLength).toBe(2);
    expect(report.removedDuplicates).toEqual([]);
    expect(report.removedInvalid).toEqual([]);
    expect(report.removedMissingFromMap).toEqual([]);
    expect(report.removedTombstoned).toEqual([]);
    expect(report.appendedOrphans).toEqual([]);
    expect(order.toArray()).toEqual(["a", "b"]);
    expect(fired).toBe(false);
  });

  it("removes duplicates and preserves first occurrence", () => {
    const { nb, order, map } = setup();
    ["a", "b", "c"].forEach((id) => map.set(id, new Y.Map()));
    setOrder(order, ["a", "b", "a", "c"]);

    const origins: any[] = [];
    order.observe((evt) => {
      origins.push((evt).transaction?.origin);
    });

    const report = reconcileNotebook(nb);

    expect(report.changed).toBe(true);
    expect(report.removedDuplicates).toEqual(["a"]);
    expect(report.removedInvalid).toEqual([]);
    expect(report.removedMissingFromMap).toEqual([]);
    expect(report.removedTombstoned).toEqual([]);
    expect(report.appendedOrphans).toEqual([]);
    expect(order.toArray()).toEqual(["a", "b", "c"]);
    expect(origins.some((o) => o === MAINT_ORIGIN)).toBe(true);
  });

  it("filters non-string entries and drops empty string by default", () => {
    const { nb, order, map } = setup();
    map.set("a", new Y.Map());
    setOrder(order, ["a", "", 42]);

    const report = reconcileNotebook(nb);

    expect(report.changed).toBe(true);
    expect(report.removedInvalid).toContain("");
    expect(report.removedInvalid).toContain("42");
    expect(order.toArray()).toEqual(["a"]);
  });

  it("keeps empty string when dropInvalidOrderEntries=false but still removes non-strings", () => {
    const { nb, order, map } = setup();
    map.set("a", new Y.Map());
    setOrder(order, ["a", "", 42]);

    const report = reconcileNotebook(nb, { dropInvalidOrderEntries: false });

    expect(report.changed).toBe(true);
    expect(report.removedInvalid).toEqual(["42"]);
    expect(order.toArray()).toEqual(["a", ""]);
  });

  it("drops ids missing from map by default, or keeps when disabled", () => {
    const { nb, order, map } = setup();
    map.set("a", new Y.Map());
    setOrder(order, ["a", "x"]);

    const r1 = reconcileNotebook(nb);
    expect(r1.changed).toBe(true);
    expect(r1.removedMissingFromMap).toEqual(["x"]);
    expect(order.toArray()).toEqual(["a"]);

    const ctx2 = setup();
    ctx2.map.set("a", new Y.Map());
    setOrder(ctx2.order, ["a", "x"]);
    const r2 = reconcileNotebook(ctx2.nb, { dropInvalidOrderEntries: false });
    expect(r2.changed).toBe(false);
    expect(r2.removedMissingFromMap).toEqual([]);
    expect(ctx2.order.toArray()).toEqual(["a", "x"]);
  });

  it("removes tombstoned ids from order by default", () => {
    const { nb, order, map } = setup();
    ["a", "b"].forEach((id) => map.set(id, new Y.Map()));
    order.push(["a", "b"]);
    const tomb = tombstonesMap(nb);
    tomb.set("b", true);

    const report = reconcileNotebook(nb);

    expect(report.changed).toBe(true);
    expect(report.removedTombstoned).toEqual(["b"]);
    expect(order.toArray()).toEqual(["a"]);
  });

  it("can keep tombstoned ids when configured", () => {
    const { nb, order, map } = setup();
    ["a", "b"].forEach((id) => map.set(id, new Y.Map()));
    order.push(["a", "b"]);
    const tomb = tombstonesMap(nb);
    tomb.set("b", true);

    const report = reconcileNotebook(nb, { dropTombstonedFromOrder: false });

    expect(report.changed).toBe(false);
    expect(report.removedTombstoned).toEqual([]);
    expect(order.toArray()).toEqual(["a", "b"]);
  });

  it("appends orphans (present in map but not in order) sorted by id by default", () => {
    const { nb, order, map } = setup();
    ["c", "b", "a"].forEach((id) => map.set(id, new Y.Map()));
    setOrder(order, ["a"]);

    const report = reconcileNotebook(nb);

    expect(report.changed).toBe(true);
    expect(report.appendedOrphans).toEqual(["b", "c"]);
    expect(order.toArray()).toEqual(["a", "b", "c"]);
  });

  it("does not append tombstoned orphans", () => {
    const { nb, order, map } = setup();
    map.set("x", new Y.Map());
    const tomb = tombstonesMap(nb);
    tomb.set("x", true);
    setOrder(order, []);

    const report = reconcileNotebook(nb);

    expect(report.changed).toBe(false);
    expect(report.appendedOrphans).toEqual([]);
    expect(order.toArray()).toEqual([]);
  });

  it("respects sortOrphansById=false (order matches map iteration order)", () => {
    const { nb, order, map } = setup();
    map.set("z", new Y.Map());
    map.set("b", new Y.Map());
    setOrder(order, []);

    const opts: ReconcileOptions = { appendOrphans: true, sortOrphansById: false };
    const report = reconcileNotebook(nb, opts);

    expect(report.changed).toBe(true);
    expect(new Set(report.appendedOrphans)).toEqual(new Set(["z", "b"]));
    expect(new Set(order.toArray())).toEqual(new Set(["z", "b"]));
  });

  // Note: We intentionally avoid testing the doc-less path because
  // certain Yjs read operations warn or are unsupported without a Doc.
});
