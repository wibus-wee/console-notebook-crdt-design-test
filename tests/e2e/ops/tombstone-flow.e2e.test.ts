import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { setupNotebook, setOrder } from "../../_helpers/notebook";
import { tombstonesMap, tombstoneMetaMap } from "@/yjs/schema/access/tombstone";
import { getCellMap, getOrder } from "@/yjs/schema/access/accessors";
import { softDeleteCell } from "@/yjs/schema/ops/soft_delete";
import { setTombstoneTimestamp, vacuumNotebook } from "@/yjs/schema/ops/tombstone_maint";

describe("E2E: tombstone flow", () => {
  it("softDelete → setTombstoneTimestamp(trusted, expired) → vacuum removes entity", () => {
    const { nb } = setupNotebook();
    const map = getCellMap(nb);
    const order = getOrder(nb);
    const tomb = tombstonesMap(nb);
    const tm = tombstoneMetaMap(nb);

    map.set("x", new Y.Map());
    setOrder(order, ["x"]);

    // Step 1: softDelete (removes from order, sets tomb flag, meta with local clock)
    softDeleteCell(nb, "x", "trash");
    expect(order.toArray()).toEqual([]);
    expect(tomb.get("x")).toBe(true);

    // Step 2: server stamps a trusted, already-expired timestamp
    const now = Date.UTC(2024, 0, 15);
    const ttl = 1000;
    setTombstoneTimestamp(nb, "x", now - ttl - 1, { trusted: true });
    const meta = tm.get("x") as Y.Map<any>;
    expect(meta.get("deletedAt")).toBe(now - ttl - 1);
    expect(meta.get("clock")).toBe("trusted");

    // Step 3: vacuum at trusted now removes entity + meta + tomb flag
    vacuumNotebook(nb, ttl, { now, nowTrusted: true });
    expect(map.has("x")).toBe(false);
    expect(tm.get("x")).toBeUndefined();
    expect(tomb.get("x")).toBeUndefined();
  });
});

