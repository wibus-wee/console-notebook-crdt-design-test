import type { QueryResponse } from "@/yjs/api-gen-type";
import * as Y from "yjs";

export type CellKind = "sql" | "markdown";

export interface CellMetadataModel {
  backgroundDDL?: boolean;
}
export const DEFAULT_CELL_METADATA: Readonly<CellMetadataModel> = Object.freeze({
  backgroundDDL: false,
});

export interface CellModel {
  id: string;
  kind: CellKind;
  source: string;
  metadata: CellMetadataModel;
  fingerprint?: string;
  executedBy?: string;
}

export interface NotebookMetadataModel {
  appVersion?: string;
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

export interface CellOutputRecord {
  running: boolean;        // 是否正在执行
  stale: boolean;          // 源变更后置 true，执行成功时置 false
  startedAt?: number;      // 执行开始时刻
  completedAt?: number;    // 执行完成时刻
  runId?: string;          // 本次执行的标识（用于并发守门）
  result?: QueryResponse; // 固定结构的查询结果
}

// Y Handles（Outputs）
type CellOutputValue = CellOutputRecord[keyof CellOutputRecord];
export type YOutputEntry = Y.Map<CellOutputValue>;
export type YOutputsMap = Y.Map<YOutputEntry>;


// Y Handles (keep permissive any typing to align with Yjs flexibility)
export type YNotebook = Y.Map<any>;
export type YCell = Y.Map<any>;

export interface NotebookRoot {
  root: YNotebook;
  schemaMeta: Y.Map<any>;
}
