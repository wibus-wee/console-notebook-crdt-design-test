import * as Y from "yjs";
import { registerNotebookMigration } from "./registry";
import { NB_OUTPUTS } from "../core/keys";
import { MAINT_ORIGIN } from "../core/origins";

/**
 * v1_000_000 → v1_000_001
 * - Ensure NB_OUTPUTS (Y.Map) exists at root.
 */
registerNotebookMigration(1_000_000, (ctx) => {
  const { doc, root, log } = ctx;
  const apply = () => {
    const r = root as Y.Map<any>;
    if (!r.has(NB_OUTPUTS)) {
      r.set(NB_OUTPUTS, new Y.Map());
      log?.(`[migration v1_000_001] Created root outputs map (${NB_OUTPUTS}).`);
    } else {
      log?.(`[migration v1_000_001] Outputs map already present.`);
    }
  };

  // 事务封装，避免进入撤销栈
  doc.transact(apply, MAINT_ORIGIN);
});
