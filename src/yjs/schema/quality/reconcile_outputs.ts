import * as Y from "yjs";
import { MAINT_ORIGIN } from "../core/origins";
import { NB_OUTPUTS } from "../core/keys";
import type { YNotebook } from "../core/types";
import { getCellMap } from "../access/accessors";
import { validateNotebook, type ValidationIssue } from "./validation";
import { withTransactOptional } from "../core/transaction";

export interface ReconcileOutputsOptions {
  /** 移除 cellMap 不存在的孤立 outputs */
  removeOrphans?: boolean;
  /** 移除非 Y.Map 结构的输出条目 */
  removeInvalid?: boolean;
  /** 校验后返回结果 */
  validateAfter?: boolean;
}

export interface ReconcileOutputsReport {
  changed: boolean;
  previousCount: number;
  finalCount: number;
  removedOrphans: string[];
  removedInvalid: string[];
  patchStats: {
    deletedCount: number;
  };
  validationIssues?: ValidationIssue[];
}

/**
 * 清理 outputs 区的孤立或非法记录。
 * - 删除 key 非字符串 / 对应 cell 已不存在 / 非 Y.Map
 * - 不修复 result 内容或时间戳
 */
export const reconcileOutputs = (
  nb: YNotebook,
  opts?: ReconcileOutputsOptions
): ReconcileOutputsReport => {
  const options: Required<ReconcileOutputsOptions> = {
    removeOrphans: opts?.removeOrphans ?? true,
    removeInvalid: opts?.removeInvalid ?? true,
    validateAfter: opts?.validateAfter ?? false,
  };

  const outputs = nb.get(NB_OUTPUTS) as Y.Map<Y.Map<any>> | undefined;
  const map = getCellMap(nb);
  if (!outputs) {
    return {
      changed: false,
      previousCount: 0,
      finalCount: 0,
      removedOrphans: [],
      removedInvalid: [],
      patchStats: { deletedCount: 0 },
    };
  }

  const beforeCount = outputs.size;
  const removedOrphans: string[] = [];
  const removedInvalid: string[] = [];

  outputs.forEach((entry, key) => {
    // 非字符串 key
    if (typeof key !== "string" || key.length === 0) {
      if (options.removeInvalid) removedInvalid.push(String(key));
      return;
    }
    // 非 Y.Map
    if (!(entry instanceof Y.Map)) {
      if (options.removeInvalid) removedInvalid.push(key);
      return;
    }
    // 孤立（map 中不存在）
    if (options.removeOrphans && !map.has(key)) {
      removedOrphans.push(key);
    }
  });

  const willDelete = removedOrphans.length + removedInvalid.length > 0;
  if (willDelete) {
    const apply = () => {
      for (const id of removedInvalid) outputs.delete(id);
      for (const id of removedOrphans) outputs.delete(id);
    };
    withTransactOptional(nb, apply, MAINT_ORIGIN);
  }

  const afterCount = outputs.size;
  const validationIssues = options.validateAfter ? validateNotebook(nb) : undefined;

  return {
    changed: willDelete,
    previousCount: beforeCount,
    finalCount: afterCount,
    removedOrphans,
    removedInvalid,
    patchStats: { deletedCount: removedInvalid.length + removedOrphans.length },
    validationIssues,
  };
};
