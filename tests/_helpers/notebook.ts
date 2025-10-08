import * as Y from "yjs";
import { ensureNotebookInDoc } from "@/yjs/schema/bootstrap";
import { getCellMap, getOrder } from "@/yjs/schema/access/accessors";
import { tombstonesMap, tombstoneMetaMap } from "@/yjs/schema/access/tombstone";

export const setupNotebook = () => {
  const doc = new Y.Doc();
  const nb = ensureNotebookInDoc(doc, { title: "t" });
  const order = getOrder(nb);
  const map = getCellMap(nb);
  const tomb = tombstonesMap(nb);
  const tm = tombstoneMetaMap(nb);
  return { doc, nb, order, map, tomb, tm };
};

export const setOrder = (order: Y.Array<string>, ids: any[]) => {
  const len = order.length;
  if (len) order.delete(0, len);
  (order as unknown as Y.Array<any>).insert(0, ids);
};

export const tombMetaSnapshot = (nb: Y.Map<any>, id: string) => {
  const tm = tombstoneMetaMap(nb);
  const entry = tm.get(id) as Y.Map<any> | undefined;
  if (!entry) return undefined;
  return {
    deletedAt: entry.get("deletedAt") as number | undefined,
    clock: entry.get("clock") as "trusted" | "local" | undefined,
    reason: entry.get("reason") as string | undefined,
  };
};

