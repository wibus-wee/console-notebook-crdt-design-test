import * as Y from "yjs";

export type CellKind = "sql" | "markdown" | "code" | "chart" | "raw";

export interface CellMetadataModel {
  backgroundDDL?: boolean;
}
export const DEFAULT_CELL_METADATA: Readonly<CellMetadataModel> = Object.freeze({
  backgroundDDL: false,
});

export interface CellModel {
  id: string;
  kind: CellKind;
  language?: string;
  source: string;
  metadata: CellMetadataModel;
  fingerprint?: string;
  executedBy?: string;
}

export interface NotebookMetadataModel {
  appVersion?: string;
  notebookType?: "sql" | "md" | "python" | string;
}

export interface NotebookModel {
  id: string;
  title: string;
  databaseId: string | null;
  tags: string[];
  metadata: NotebookMetadataModel;
  order: string[]; // 有序 cellId 列表
  tombstones: Record<string, true>;
}

// Y Handles (keep permissive any typing to align with Yjs flexibility)
export type YNotebook = Y.Map<any>;
export type YCell = Y.Map<any>;

export interface NotebookRoot {
  root: YNotebook;
  schemaMeta: Y.Map<any>;
}
