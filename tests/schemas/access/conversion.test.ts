import { describe, it, expect, vi, afterEach } from "vitest";
import * as Y from "yjs";

import { yCellToModel, yNotebookToModel, yOutputsToModel } from "@/yjs/schema/access/conversion";
// Note: Avoid createCell here because it locks id before the cell is bound to a Doc.
import { bootstrapDoc } from "@/yjs/schema/bootstrap";
import { getOutputsMap } from "@/yjs/schema/access/outputs";
import {
  CELL_ID,
  CELL_KIND,
  CELL_META,
  CELL_SOURCE,
  NB_ID,
  NB_TITLE,
  NB_DATABASE_ID,
  NB_TAGS,
  NB_METADATA,
  NB_CELL_ORDER,
  NB_TOMBSTONES,
} from "@/yjs/schema/core/keys";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("yCellToModel", () => {
  it("converts a well-formed cell (including metadata, fingerprint, executedBy)", () => {
    const doc = new Y.Doc();
    const nb = bootstrapDoc(doc);
    const c = new Y.Map<any>();
    // bind to doc before reads
    nb.set("tmpCell", c);

    c.set(CELL_ID, "c1");
    c.set(CELL_KIND, "sql");
    const t = new Y.Text();
    t.insert(0, "SELECT 1");
    c.set(CELL_SOURCE, t);
    const m = new Y.Map<any>();
    m.set("backgroundDDL", true);
    c.set(CELL_META, m);
    c.set("fingerprint", "fp-1");
    c.set("executedBy", "u-42");

    const model = yCellToModel(c as any);
    expect(model.id).toBe("c1");
    expect(model.kind).toBe("sql");
    expect(model.source).toBe("SELECT 1");
    expect(model.metadata.backgroundDDL).toBe(true);
    expect(model.fingerprint).toBe("fp-1");
    expect(model.executedBy).toBe("u-42");
  });

  it("warns and applies tolerant defaults when id/kind are missing or invalid", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const doc = new Y.Doc();
    const nb = bootstrapDoc(doc);
    const c = new Y.Map<any>();
    nb.set("tmpCell2", c);

    // No id/kind set; has source text and empty metadata map
    const txt = new Y.Text();
    txt.insert(0, "x");
    c.set(CELL_SOURCE, txt);
    c.set(CELL_META, new Y.Map<any>());

    const model = yCellToModel(c as any);
    expect(model.id).toBe(""); // cast from undefined → ""
    expect(model.kind).toBe("raw"); // tolerant fallback
    expect(model.source).toBe("x");
    expect(model.metadata.backgroundDDL).toBe(false);
    expect(model.fingerprint).toBeUndefined();
    expect(model.executedBy).toBeUndefined();

    // two warnings: id not string, kind not string
    const msgs = warn.mock.calls.map((c) => String(c[0]));
    expect(msgs.some((m) => m.includes("Cell id is not a string"))).toBe(true);
    expect(msgs.some((m) => m.includes("Cell kind is not a string"))).toBe(true);
  });
});

describe("yNotebookToModel", () => {
  it("converts notebook fields and filters tombstones to true-only entries", () => {
    const doc = new Y.Doc();
    const nb = bootstrapDoc(doc);

    // Scalars (override bootstrap defaults)
    nb.set(NB_ID, "nb-1");
    nb.set(NB_TITLE, "Notebook T");
    nb.set(NB_DATABASE_ID, "db-001");

    // Arrays/Maps
    const tags = new Y.Array<string>();
    tags.push(["a", "b"]);
    nb.set(NB_TAGS, tags);

    const meta = new Y.Map<any>();
    meta.set("appVersion", "1.2.3");
    nb.set(NB_METADATA, meta);

    const order = new Y.Array<string>();
    order.push(["c1", "c2"]);
    nb.set(NB_CELL_ORDER, order);

    const tomb = new Y.Map<boolean>();
    tomb.set("c1", true);
    tomb.set("c2", false);
    nb.set(NB_TOMBSTONES, tomb);

    const model = yNotebookToModel(nb as any);
    expect(model.id).toBe("nb-1");
    expect(model.title).toBe("Notebook T");
    expect(model.databaseId).toBe("db-001");
    expect(model.tags).toEqual(["a", "b"]);
    expect(model.metadata.appVersion).toBe("1.2.3");
    expect(model.order).toEqual(["c1", "c2"]);
    expect(model.tombstones).toEqual({ c1: true });
  });

  it("applies defaults when values have unexpected types", () => {
    const doc = new Y.Doc();
    const nb = bootstrapDoc(doc);

    nb.set(NB_ID, 123 as any); // → "123"
    nb.set(NB_TITLE, 456 as any); // → "Untitled Notebook"
    nb.set(NB_DATABASE_ID, 999 as any); // → null
    nb.set(NB_METADATA, new Y.Map<any>()); // no appVersion
    nb.set(NB_TOMBSTONES, new Y.Map<boolean>([["x", false]])); // filtered out
    // NB_TAGS, NB_CELL_ORDER left as-is → []

    const model = yNotebookToModel(nb as any);
    expect(model.id).toBe("123");
    expect(model.title).toBe("Untitled Notebook");
    expect(model.databaseId).toBeNull();
    expect(model.tags).toEqual([]);
    expect(model.metadata).toEqual({});
    expect(model.order).toEqual([]);
    expect(model.tombstones).toEqual({});
  });
});

describe("yOutputsToModel (additional edge cases)", () => {
  it("coerces defaults and ignores invalid ids/fields", () => {
    const doc = new Y.Doc();
    const nb = bootstrapDoc(doc);
    const outputs = getOutputsMap(nb);

    // invalid id (empty string) → skipped
    outputs.set("", new Y.Map<any>());

    // non-Map entry → skipped
    outputs.set("badval", 42 as any);

    // valid entry with various invalid field types
    const e = new Y.Map<any>();
    e.set("running", "yes" as any); // not boolean → keep default false
    e.set("stale", 1 as any); // not boolean → keep default false
    e.set("startedAt", "10" as any); // not number → ignored
    e.set("completedAt", 20);
    e.set("result", {
      columns: [],
      rows: [],
      rowsAffected: 0,
      error: 123, // not string → omitted
      extra: "ignore-me",
    });
    outputs.set("ok", e);

    const model = yOutputsToModel(nb);
    expect(model.ok).toBeTruthy();
    expect(model.ok.running).toBe(false);
    expect(model.ok.stale).toBe(false);
    expect(model.ok.startedAt).toBeUndefined();
    expect(model.ok.completedAt).toBe(20);
    expect(model.ok.result).toBeTruthy();
    expect(model.ok.result?.rowsAffected).toBe(0);
    expect((model.ok.result as any).extra).toBeUndefined();
    expect(model.ok.result?.error).toBeUndefined();

    // skipped entries are absent
    expect(Object.prototype.hasOwnProperty.call(model, "badval")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(model, "")).toBe(false);
  });
});
