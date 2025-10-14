import * as Y from "yjs";
import {
  CELL_EXEC_BY,
  CELL_FINGERPRINT,
  CELL_ID,
  CELL_KIND,
  CELL_META,
  CELL_SOURCE,
  NB_DATABASE_ID,
  NB_ID,
  NB_METADATA,
  NB_TAGS,
  NB_TITLE,
  NB_CELL_ORDER,
  NB_TOMBSTONES,
  NB_OUTPUTS,
} from "../core/keys";
import {
  type CellKind,
  type CellMetadataModel,
  type CellModel,
  type CellOutputRecord,
  DEFAULT_CELL_METADATA,
  type NotebookMetadataModel,
  type NotebookModel,
  type YCell,
  type YNotebook,
  type YOutputsMap,
} from "../core/types";
import { getCellMap } from "./accessors";

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
  
  return {
    id,
    kind,
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
  };
  const rawId = nb.get(NB_ID);
  const id = typeof rawId === "string" ? rawId : String(rawId ?? "");
  const rawTitle = nb.get(NB_TITLE);
  const title = typeof rawTitle === "string" ? rawTitle : "Untitled Notebook";
  const rawDbId = nb.get(NB_DATABASE_ID);
  const databaseId = typeof rawDbId === "string" ? rawDbId : null;
  const order = (nb.get(NB_CELL_ORDER) as Y.Array<string> | undefined)?.toArray() ?? [];
  const cells = getCellMap(nb);
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
    cells,
    tombstones,
  };
};

type OutputModel = Omit<CellOutputRecord, "runId">;

/** 将 YNotebook 中的 outputs 区转换为可序列化 JSON 对象 */
export const yOutputsToModel = (nb: YNotebook): Record<string, OutputModel> => {
  const outputs = nb.get(NB_OUTPUTS) as YOutputsMap;
  if (!outputs) return {};

  const result: Record<string, OutputModel> = {};

  outputs.forEach((entry, id) => {
    if (!(entry instanceof Y.Map)) return; // skip invalid
    if (typeof id !== "string" || id.length === 0) return;

    const out: OutputModel = {
      running: false,
      stale: false,
    };
    const running = entry.get("running");
    const stale = entry.get("stale");
    const startedAt = entry.get("startedAt");
    const completedAt = entry.get("completedAt");
    const qres = entry.get("result");

    if (typeof running === "boolean") out.running = running;
    if (typeof stale === "boolean") out.stale = stale;
    if (typeof startedAt === "number") out.startedAt = startedAt;
    if (typeof completedAt === "number") out.completedAt = completedAt;

    // result 对象结构容忍性转换
    if (
      qres &&
      typeof qres === "object" &&
      Array.isArray(qres.columns) &&
      Array.isArray(qres.rows) &&
      typeof qres.rowsAffected === "number"
    ) {
      out.result = {
        columns: qres.columns,
        rows: qres.rows,
        rowsAffected: qres.rowsAffected,
        ...(typeof qres.error === "string" ? { error: qres.error } : {}),
      };
    }

    result[id] = out;
  });

  return result;
};