import * as Y from "yjs";
import { ulid } from "ulid";
import {
  NB_DATABASE_ID,
  NB_ID,
  NB_METADATA,
  NB_TAGS,
  NB_TITLE,
  NB_CELL_MAP,
  NB_CELL_ORDER,
  NB_TOMBSTONE_META,
  NB_TOMBSTONES,
} from "./core/keys";
import type { NotebookModel, YNotebook } from "./core/types";
import { ensureNotebookRoot } from "./access/root";
import { getCellMap, getOrder } from "./access/accessors";
import { lockCellId } from "./access/cells";

// Creation & Initialization
export const ensureNotebookInDoc = (doc: Y.Doc, init?: Partial<NotebookModel>): YNotebook => {
  const { root } = ensureNotebookRoot(doc);

  // 标识字段
  if (!root.has(NB_ID)) {
    // we should use a server-assigned id in most cases
    console.warn("Client-side notebook initialization occurred unexpectedly.");
    root.set(NB_ID, init?.id ?? ulid());
  }
  if (!root.has(NB_TITLE)) root.set(NB_TITLE, init?.title ?? "Untitled Notebook");
  if (!root.has(NB_DATABASE_ID)) root.set(NB_DATABASE_ID, init?.databaseId ?? null);

  // tags
  if (!root.has(NB_TAGS)) root.set(NB_TAGS, new Y.Array<string>());
  const tags = root.get(NB_TAGS) as Y.Array<string>;
  if (init?.tags?.length) {
    const exist = new Set(tags.toArray());
    const add: string[] = [];
    for (const tag of init.tags) {
      if (exist.has(tag)) continue;
      exist.add(tag);
      add.push(tag);
    }
    if (add.length) tags.push(add);
  }

  // metadata
  if (!root.has(NB_METADATA)) root.set(NB_METADATA, new Y.Map<any>());
  const meta = root.get(NB_METADATA) as Y.Map<any>;
  if (init?.metadata) {
    for (const [k, v] of Object.entries(init.metadata)) {
      if (v === undefined || meta.has(k)) continue;
      meta.set(k, v as any);
    }
  }

  // cell structures (Map + Order)
  if (!root.has(NB_CELL_MAP)) root.set(NB_CELL_MAP, new Y.Map<any>());
  if (!root.has(NB_CELL_ORDER)) root.set(NB_CELL_ORDER, new Y.Array<string>());

  // tombstones
  if (!root.has(NB_TOMBSTONES)) root.set(NB_TOMBSTONES, new Y.Map<boolean>());
  if (!root.has(NB_TOMBSTONE_META)) root.set(NB_TOMBSTONE_META, new Y.Map<any>());

  // optional seed for order
  if (init?.order?.length) {
    getCellMap(root); // Ensure NB_CELL_MAP exists
    const order = getOrder(root);
    const existing = new Set(order.toArray());
    const append: string[] = [];
    for (const id of init.order) {
      if (existing.has(id)) continue;
      existing.add(id);
      append.push(id);
    }
    if (append.length) order.push(append);
  }

  const cellMap = root.get(NB_CELL_MAP) as Y.Map<any> | undefined;
  cellMap?.forEach((cell: any) => {
    if (cell instanceof Y.Map) lockCellId(cell as any);
  });

  return root as any;
};

/** 最小化引导：不做版本迁移；仅建立结构并返回 root */
export const bootstrapDoc = (doc: Y.Doc, init?: Partial<NotebookModel>) => {
  const root = ensureNotebookInDoc(doc, init);
  return root;
};
