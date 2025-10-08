import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { setupNotebook, setOrder, tombMetaSnapshot } from "../../_helpers/notebook";
import { tombstonesMap, tombstoneMetaMap } from "@/yjs/schema/access/tombstone";
import { getCellMap, getOrder } from "@/yjs/schema/access/accessors";
import { softDeleteCell, restoreCell } from "@/yjs/schema/ops/soft_delete";
import { setTombstoneTimestamp, vacuumNotebook } from "@/yjs/schema/ops/tombstone_maint";
import { USER_ACTION_ORIGIN, MAINT_ORIGIN, VACUUM_ORIGIN } from "@/yjs/schema/core/origins";
import { DEFAULT_FUTURE_SKEW_MS, WALL_CLOCK_EPOCH_FLOOR_MS } from "@/yjs/schema/core/time";

describe("tombstone chain", () => {
  it("softDelete removes from order, sets tombstone flag and meta (deletedAt/clock)", () => {
    const { nb, order, map, tomb } = setupNotebook();
    map.set("x", new Y.Map());
    setOrder(order, ["x"]);

    const t0 = Date.UTC(2024, 0, 2);

    const origins: any[] = [];
    order.observe((evt) => origins.push(evt.transaction?.origin));
    tomb.observe((evt) => origins.push(evt.transaction?.origin));

    softDeleteCell(nb, "x", "trash", { timestamp: t0, trusted: true });

    expect(order.toArray()).toEqual([]);
    expect(tombstonesMap(nb).get("x")).toBe(true);
    const meta = tombMetaSnapshot(nb, "x")!;
    expect(meta.deletedAt).toBe(t0);
    expect(meta.clock).toBe("trusted");
    expect(meta.reason).toBe("trash");
    expect(origins.some((o) => o === USER_ACTION_ORIGIN)).toBe(true);
  });

  it("softDelete without explicit timestamp uses local clock by default", () => {
    const { nb, order, map } = setupNotebook();
    map.set("y", new Y.Map());
    setOrder(order, ["y"]);

    softDeleteCell(nb, "y");

    expect(order.toArray()).toEqual([]);
    const meta = tombMetaSnapshot(nb, "y")!;
    expect(meta.clock).toBe("local");
    expect(typeof meta.deletedAt).toBe("number");
    expect((meta.deletedAt as number) >= WALL_CLOCK_EPOCH_FLOOR_MS).toBe(true);
  });

  it("restore clears tombstone and meta, and reinserts at index", () => {
    const { nb, order, map } = setupNotebook();
    map.set("a", new Y.Map());
    map.set("b", new Y.Map());
    map.set("x", new Y.Map());
    setOrder(order, ["a", "b"]);

    // soft delete x first (it might not be in order yet)
    softDeleteCell(nb, "x", "trash", { timestamp: Date.UTC(2024, 0, 2), trusted: true });

    const origins: any[] = [];
    order.observe((evt) => origins.push(evt.transaction?.origin));
    tombstonesMap(nb).observe((evt) => origins.push(evt.transaction?.origin));
    tombstoneMetaMap(nb).observe((evt) => origins.push(evt.transaction?.origin));

    restoreCell(nb, "x", 1);

    expect(order.toArray()).toEqual(["a", "x", "b"]);
    expect(tombstonesMap(nb).get("x")).toBeUndefined();
    expect(tombstoneMetaMap(nb).get("x")).toBeUndefined();
    expect(origins.some((o) => o === USER_ACTION_ORIGIN)).toBe(true);
  });

  it("setTombstoneTimestamp adds flag when absent and tags clock correctly", () => {
    const { nb } = setupNotebook();

    const t1 = Date.UTC(2024, 0, 10);
    const origins: any[] = [];
    tombstonesMap(nb).observe((evt) => origins.push(evt.transaction?.origin));
    tombstoneMetaMap(nb).observe((evt) => origins.push(evt.transaction?.origin));

    // Without pre-existing flag
    setTombstoneTimestamp(nb, "y", t1, { trusted: false });
    expect(tombstonesMap(nb).get("y")).toBe(true);
    const meta1 = tombMetaSnapshot(nb, "y")!;
    expect(meta1.deletedAt).toBe(t1);
    expect(meta1.clock).toBe("local");
    expect(origins.some((o) => o === MAINT_ORIGIN)).toBe(true);

    // And with clock-based trust resolution
    const { nb: nb2 } = setupNotebook();
    const t2 = Date.UTC(2024, 0, 11);
    setTombstoneTimestamp(nb2, "z", t2, { clock: { now: () => 0, trusted: false } });
    const meta2 = tombMetaSnapshot(nb2, "z")!;
    expect(meta2.clock).toBe("local");
  });

  it("setTombstoneTimestamp rejects invalid timestamp (no-op)", () => {
    const { nb } = setupNotebook();
    const invalid = WALL_CLOCK_EPOCH_FLOOR_MS - 1000;
    setTombstoneTimestamp(nb, "k", invalid);
    expect(tombstonesMap(nb).get("k")).toBeUndefined();
    expect(tombstoneMetaMap(nb).get("k")).toBeUndefined();
  });

  describe("vacuum conditions", () => {
    it("cleans only when ts is trusted, TTL satisfied, and id not in order", () => {
      const { nb } = setupNotebook();
      const map = getCellMap(nb);
      const order = getOrder(nb);
      const tomb = tombstonesMap(nb);
      const tm = tombstoneMetaMap(nb);

      map.set("x", new Y.Map());
      setOrder(order, []);
      const now = 10_000_000;
      const ttl = 1000;
      tm.set("x", new Y.Map<any>([["deletedAt", now - ttl - 1], ["clock", "trusted"]]));
      tomb.set("x", true);

      const origins: any[] = [];
      order.observe((evt) => origins.push(evt.transaction?.origin));
      tomb.observe((evt) => origins.push(evt.transaction?.origin));
      tm.observe((evt) => origins.push(evt.transaction?.origin));

      vacuumNotebook(nb, ttl, { now, nowTrusted: true });

      expect(map.has("x")).toBe(false);
      expect(tm.get("x")).toBeUndefined();
      expect(tomb.get("x")).toBeUndefined();
      expect(origins.some((o) => o === VACUUM_ORIGIN)).toBe(true);
    });

    it("does not clean when timestamp clock is local", () => {
      const { nb } = setupNotebook();
      const map = getCellMap(nb);
      const order = getOrder(nb);
      const tomb = tombstonesMap(nb);
      const tm = tombstoneMetaMap(nb);

      map.set("x", new Y.Map());
      setOrder(order, []);
      const now = 10_000_000;
      const ttl = 1000;
      tm.set("x", new Y.Map<any>([["deletedAt", now - ttl - 1], ["clock", "local"]]));
      tomb.set("x", true);

      vacuumNotebook(nb, ttl, { now, nowTrusted: true });

      expect(map.has("x")).toBe(true);
      expect(tm.get("x")).toBeTruthy();
      expect(tomb.get("x")).toBe(true);
    });

    it("does not clean when TTL not satisfied", () => {
      const { nb } = setupNotebook();
      const map = getCellMap(nb);
      const order = getOrder(nb);
      const tomb = tombstonesMap(nb);
      const tm = tombstoneMetaMap(nb);

      map.set("x", new Y.Map());
      setOrder(order, []);
      const now = 10_000_000;
      const ttl = 1000;
      tm.set("x", new Y.Map<any>([["deletedAt", now - ttl + 1], ["clock", "trusted"]]));
      tomb.set("x", true);

      vacuumNotebook(nb, ttl, { now, nowTrusted: true });

      expect(map.has("x")).toBe(true);
      expect(tm.get("x")).toBeTruthy();
      expect(tomb.get("x")).toBe(true);
    });

    it("does not clean when id is still in order", () => {
      const { nb } = setupNotebook();
      const map = getCellMap(nb);
      const order = getOrder(nb);
      const tomb = tombstonesMap(nb);
      const tm = tombstoneMetaMap(nb);

      map.set("x", new Y.Map());
      setOrder(order, ["x"]);
      const now = 10_000_000;
      const ttl = 1000;
      tm.set("x", new Y.Map<any>([["deletedAt", now - ttl - 1], ["clock", "trusted"]]));
      tomb.set("x", true);

      vacuumNotebook(nb, ttl, { now, nowTrusted: true });

      expect(map.has("x")).toBe(true);
      expect(tm.get("x")).toBeTruthy();
      expect(tomb.get("x")).toBe(true);
    });

    it("future skew protection blocks cleanup when deletedAt is too far ahead", () => {
      const { nb } = setupNotebook();
      const map = getCellMap(nb);
      const order = getOrder(nb);
      const tomb = tombstonesMap(nb);
      const tm = tombstoneMetaMap(nb);

      map.set("x", new Y.Map());
      setOrder(order, []);
      const now = 10_000_000;
      const ttl = 1000;
      tm.set(
        "x",
        new Y.Map<any>([["deletedAt", now + DEFAULT_FUTURE_SKEW_MS + 10], ["clock", "trusted"]])
      );
      tomb.set("x", true);

      vacuumNotebook(nb, ttl, { now, nowTrusted: true, maxFutureSkewMs: DEFAULT_FUTURE_SKEW_MS });

      expect(map.has("x")).toBe(true);
      expect(tm.get("x")).toBeTruthy();
      expect(tomb.get("x")).toBe(true);
    });
  });

  it("does not clean when ts is trusted but nowTrusted=false", () => {
    const { nb } = setupNotebook();
    const map = getCellMap(nb);
    const order = getOrder(nb);
    const tomb = tombstonesMap(nb);
    const tm = tombstoneMetaMap(nb);

    map.set("x", new Y.Map());
    setOrder(order, []);
    const now = 10_000_000;
    const ttl = 1000;
    tm.set("x", new Y.Map<any>([["deletedAt", now - ttl - 1], ["clock", "trusted"]]));
    tomb.set("x", true);

    vacuumNotebook(nb, ttl, { now, nowTrusted: false });

    expect(map.has("x")).toBe(true);
    expect(tm.get("x")).toBeTruthy();
    expect(tomb.get("x")).toBe(true);
  });
});
