import * as Y from "yjs";

export interface NotebookMigrationContext {
  doc: Y.Doc;
  root: Y.Map<unknown>;
  fromVersion: number;
  toVersion: number;
  origin: symbol;
  log: (msg: string) => void;
}

/** 单个迁移器的签名 */
export type NotebookMigration = (ctx: NotebookMigrationContext) => void;

/** 全局迁移注册表 */
export const MIGRATION_REGISTRY = new Map<number, NotebookMigration>();

/** 注册迁移器（vX -> vY） */
export const registerNotebookMigration = (fromVersion: number, fn: NotebookMigration) => {
  if (MIGRATION_REGISTRY.has(fromVersion)) {
    throw new Error(`Migration from version ${fromVersion} already registered`);
  }
  MIGRATION_REGISTRY.set(fromVersion, fn);
};

