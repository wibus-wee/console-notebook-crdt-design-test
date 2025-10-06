import * as Y from "yjs";
import { UndoManager } from "yjs";
import { USER_ACTION_ORIGIN } from "../core/origins";
import { NB_CELL_MAP, NB_CELL_ORDER, NB_TOMBSTONE_META, NB_TOMBSTONES } from "../core/keys";
import { YNotebook, YCell } from "../core/types";

/**
 * 仅追踪用户动作：order（顺序变更）与 cellMap（内容变更）
 * 注意：VACUUM/MAINT 等维护操作使用独立 origin，不纳入撤销栈
 */
export const createNotebookUndoManager = (
  nb: YNotebook,
  opts?: { captureTimeout?: number; trackedOrigins?: Set<any> }
) => {
  const scopes: any[] = [];
  const order = nb.get(NB_CELL_ORDER) as Y.Array<string>;
  const cellMap = nb.get(NB_CELL_MAP) as Y.Map<YCell>;
  if (order) scopes.push(order);
  if (cellMap) scopes.push(cellMap);

  const tomb = nb.get(NB_TOMBSTONES) as Y.Map<boolean> | undefined;
  const tombMeta = nb.get(NB_TOMBSTONE_META) as Y.Map<any> | undefined;
  if (tomb) scopes.push(tomb);
  if (tombMeta) scopes.push(tombMeta);

  return new UndoManager(scopes as any, {
    captureTimeout: opts?.captureTimeout ?? 500,
    trackedOrigins: opts?.trackedOrigins ?? new Set([USER_ACTION_ORIGIN]),
  });
};
