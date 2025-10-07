import * as Y from "yjs";
import {
  CELL_EXEC_BY,
  CELL_FINGERPRINT,
  CELL_ID,
  CELL_KIND,
  CELL_LANG,
  CELL_META,
  CELL_SOURCE,
  NB_DATABASE_ID,
  NB_ID,
  NB_METADATA,
  NB_TAGS,
  NB_TITLE,
  NB_CELL_ORDER,
  NB_TOMBSTONES,
} from "../core/keys";
import {
  type CellKind,
  type CellMetadataModel,
  type CellModel,
  DEFAULT_CELL_METADATA,
  type NotebookMetadataModel,
  type NotebookModel,
  type YCell,
  type YNotebook,
} from "../core/types";

export const yCellToModel = (c: YCell): CellModel => {
  const src = (c.get(CELL_SOURCE) as Y.Text | undefined)?.toString() ?? "";
  const mdY = c.get(CELL_META) as Y.Map<any> | undefined;
  const metadata: CellMetadataModel = {
    backgroundDDL: mdY?.get("backgroundDDL") ?? DEFAULT_CELL_METADATA.backgroundDDL,
  };
  const rawId = c.get(CELL_ID);
  const id = typeof rawId === "string" ? rawId : String(rawId ?? "");
  if (typeof rawId !== "string") {
    console.warn(`Cell id is not a string, got ${String(rawId)}`);
  }
  const rawKind = c.get(CELL_KIND);
  const kind = (typeof rawKind === "string" ? rawKind : "raw") as CellKind;
  if (typeof rawKind !== "string") {
    console.warn(`Cell kind is not a string for id ${id}`);
  }
  const languageValue = c.get(CELL_LANG);
  return {
    id,
    kind,
    language: typeof languageValue === "string" ? languageValue : undefined,
    source: src,
    metadata,
    fingerprint: c.get(CELL_FINGERPRINT) ?? undefined,
    executedBy: c.get(CELL_EXEC_BY) ?? undefined,
  };
};

export const yNotebookToModel = (nb: YNotebook): NotebookModel => {
  const tags = (nb.get(NB_TAGS) as Y.Array<string> | undefined)?.toArray() ?? [];
  const metaY = nb.get(NB_METADATA) as Y.Map<any> | undefined;
  const metadata: NotebookMetadataModel = {
    appVersion: metaY?.get("appVersion") ?? undefined,
    notebookType: metaY?.get("notebookType") ?? undefined,
  };
  const rawId = nb.get(NB_ID);
  const id = typeof rawId === "string" ? rawId : String(rawId ?? "");
  const rawTitle = nb.get(NB_TITLE);
  const title = typeof rawTitle === "string" ? rawTitle : "Untitled Notebook";
  const rawDbId = nb.get(NB_DATABASE_ID);
  const databaseId = typeof rawDbId === "string" ? rawDbId : null;
  const order = (nb.get(NB_CELL_ORDER) as Y.Array<string> | undefined)?.toArray() ?? [];
  const tomb = nb.get(NB_TOMBSTONES) as Y.Map<boolean> | undefined;
  const tombstones: Record<string, true> = {};
  tomb?.forEach((v, k) => {
    if (v) tombstones[k] = true;
  });

  return {
    id,
    title,
    databaseId,
    tags,
    metadata,
    order,
    tombstones,
  };
};

