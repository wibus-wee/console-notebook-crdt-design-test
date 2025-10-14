import * as Y from "yjs";
import { CELL_ID, CELL_KIND, CELL_META, CELL_SOURCE } from "@/yjs/schema/core/keys";
import { DEFAULT_CELL_METADATA, type CellKind, type YCell, type YNotebook } from "@/yjs/schema/core/types";
import { insertCell as insertCellMutation, moveCell as moveCellMutation, removeCell as removeCellMutation } from "@/yjs/schema/ops/mutations";
import type { InsertCellOptions, NotebookActions } from "./types";

const defaultSourceByKind: Record<CellKind, string> = {
  sql: "SELECT 1;",
  markdown: "## 新建 Markdown Cell\n在这里记录你的想法。",
};

const resolveInitialSource = (kind: CellKind, provided?: string) =>
  typeof provided === "string" ? provided : defaultSourceByKind[kind];

const createCellDraft = (kind: CellKind, opts?: InsertCellOptions): YCell => {
  const cell = new Y.Map<any>();
  const text = new Y.Text();
  const source = resolveInitialSource(kind, opts?.source);
  if (source.length > 0) text.insert(0, source);
  
  cell.set(CELL_KIND, kind);
  cell.set(CELL_SOURCE, text);

  const metadata = new Y.Map<any>();
  const background = opts?.metadata?.backgroundDDL ?? DEFAULT_CELL_METADATA.backgroundDDL;
  if (background !== DEFAULT_CELL_METADATA.backgroundDDL) metadata.set("backgroundDDL", background);
  cell.set(CELL_META, metadata);

  return cell as YCell;
};

export const createNotebookActions = (nb: YNotebook): NotebookActions => ({
  insertCell: (kind, opts) => {
    const cell = createCellDraft(kind, opts);
    insertCellMutation(nb, cell, opts?.index);
    const cellId = cell.get(CELL_ID) as string;
    // Invalidation is no longer needed; the snapshot atom will update automatically.
    return cellId;
  },
  removeCell: (cellId) => {
    removeCellMutation(nb, cellId);
  },
  moveCell: (cellId, toIndex) => {
    moveCellMutation(nb, cellId, toIndex);
  },
});
