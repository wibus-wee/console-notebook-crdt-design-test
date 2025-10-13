import * as Y from "yjs";
import { createYMapKeyAtom, createYAtom } from "../yJotai";
import { NB_TITLE, NB_CELL_ORDER } from "@/yjs/schema/core/keys";
import { getOrder } from "@/yjs/schema/access/accessors";
import type { YNotebook } from "@/yjs/schema/core/types";

/**
 * Create a title atom backed by the notebook root map.
 * Ensures we always expose a string to React components.
 */
export const createNotebookTitleAtom = (nb: YNotebook) =>
  createYMapKeyAtom<any, string>(nb, NB_TITLE, {
    decode: (value) => (typeof value === "string" && value.length > 0 ? value : "Untitled Notebook"),
    encode: (value) => value,
  });

/**
 * Create an atom representing the ordered list of cell ids.
 * Uses a deep equality guard supplied by the bridge to avoid noisy renders.
 */
export const createNotebookOrderAtom = (nb: YNotebook) => {
  return createYAtom<Y.Map<any>, string[]>({
    y: nb,
    read: () => Object.freeze(getOrder(nb).toArray()) as string[],
    deep: true,
    eventFilter: (evt) => {
      if (Array.isArray(evt)) {
        return evt.some((e) => Array.isArray(e.path) && e.path[0] === NB_CELL_ORDER);
      }
      return evt.keysChanged ? evt.keysChanged.has(NB_CELL_ORDER) : false;
    },
  });
};
