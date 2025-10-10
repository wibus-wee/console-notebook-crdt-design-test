import * as Y from "yjs";
import { NB_OUTPUTS, NB_TOMBSTONES } from "../core/keys";
import { CELL_ID, CELL_KIND } from "../core/keys";
import type { YNotebook, YCell, YOutputsMap } from "../core/types";
import { getCellMap, getOrder } from "../access/accessors";
import { type TombstoneMetaMap, tombstoneMetaMap, isValidTombstoneClock } from "../access/tombstone";
import type { QueryResponse } from "@/yjs/api-gen-type";

export interface ValidationIssue {
  path: string;
  level: "error" | "warning";
  message: string;
}

/** 基本一致性校验：id 唯一性、顺序引用完整性、tombstone 合法性 */
export const validateNotebook = (nb: YNotebook): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];

  const order = getOrder(nb).toArray();
  const map = getCellMap(nb);
  const tomb = nb.get(NB_TOMBSTONES) as Y.Map<boolean> | undefined;
  const tombSet = new Set<string>();
  tomb?.forEach((flag, id) => {
    if (flag) tombSet.add(id);
  });

  // 1) order 中的 id 必须存在于 map，且不重复
  const seenOrder = new Map<string, number>();
  order.forEach((id, idx) => {
    if (typeof id !== "string" || id.length === 0) {
      issues.push({
        path: `order[${idx}]`,
        level: "error",
        message: `Invalid cell id at order[${idx}]`,
      });
      return;
    }
    const dup = seenOrder.get(id);
    if (dup !== undefined) {
      issues.push({
        path: `order[${idx}]`,
        level: "error",
        message: `Duplicate cell id "${id}" also present at order[${dup}]`,
      });
    } else {
      seenOrder.set(id, idx);
    }
    if (!map.has(id)) {
      issues.push({
        path: `order[${idx}]`,
        level: "error",
        message: `Cell id "${id}" referenced by order but missing in cellMap`,
      });
    }
    if (tombSet.has(id)) {
      issues.push({
        path: `order[${idx}]`,
        level: "warning",
        message: `Cell id "${id}" appears in order but is marked tombstoned`,
      });
    }
  });

  const orderSet = new Set<string>(order.filter((id): id is string => typeof id === "string"));

  // 2) map 中的 id 若未出现在 order，说明它是孤立实体（可能是 tombstone 残留或待恢复）
  map.forEach((cell: YCell, id) => {
    if (!orderSet.has(id)) {
      issues.push({
        path: `cellMap.${id}`,
        level: "warning",
        message: `Cell id "${id}" exists in cellMap but not referenced by order`,
      });
    }
    const kind = cell?.get(CELL_KIND);
    if (!kind) {
      issues.push({
        path: `cellMap.${id}`,
        level: "error",
        message: `Missing cell kind for "${id}"`,
      });
    }
    const embeddedId = cell?.get(CELL_ID);
    if (embeddedId !== undefined && embeddedId !== id) {
      issues.push({
        path: `cellMap.${id}`,
        level: "warning",
        message: `cellMap key "${id}" mismatches embedded id "${embeddedId}"`,
      });
    }
  });

  // 3) Tombstone 合法性
  const tm = nb.get("tombstoneMeta") as TombstoneMetaMap | undefined;
  const tmm = tm ?? tombstoneMetaMap(nb);
  tmm?.forEach((meta, id) => {
    const deletedAt = meta?.get("deletedAt");
    if (deletedAt != null && (typeof deletedAt !== "number" || Number.isNaN(deletedAt))) {
      issues.push({
        path: `tombstoneMeta.${id}`,
        level: "warning",
        message: `Invalid deletedAt for "${id}"`,
      });
    }
    const clock = meta?.get("clock");
    if (clock != null && !isValidTombstoneClock(clock)) {
      issues.push({
        path: `tombstoneMeta.${id}`,
        level: "warning",
        message: `Invalid clock tag for "${id}"`,
      });
    }
  });

  tomb?.forEach((flag, id) => {
    if (!flag) return;
    if (!map.has(id)) {
      issues.push({
        path: `tombstones.${id}`,
        level: "warning",
        message: `Tombstone exists for "${id}" but cellMap no longer has the entity`,
      });
    }
  });

  // 4) Outputs 区域检查
  const outputs = nb.get(NB_OUTPUTS) as YOutputsMap | undefined;
  if (outputs) {
    outputs.forEach((entry, id) => {
      if (typeof id !== "string" || id.length === 0) {
        issues.push({
          path: `outputs[${id}]`,
          level: "error",
          message: `Invalid output key "${id}"`,
        });
        return;
      }

      // 4.1 关联完整性：outputs 中的 id 必须存在于 cellMap
      if (!map.has(id)) {
        issues.push({
          path: `outputs.${id}`,
          level: "warning",
          message: `Output exists for "${id}" but cellMap no longer contains this cell`,
        });
      }

      // 4.2 字段类型与结构合法性
      if (!(entry instanceof Y.Map)) {
        issues.push({
          path: `outputs.${id}`,
          level: "error",
          message: `Output record for "${id}" is not a Y.Map`,
        });
        return;
      }

      const running = entry.get("running");
      const stale = entry.get("stale");
      if (running != null && typeof running !== "boolean") {
        issues.push({
          path: `outputs.${id}.running`,
          level: "warning",
          message: `"running" should be boolean, got ${typeof running}`,
        });
      }
      if (stale != null && typeof stale !== "boolean") {
        issues.push({
          path: `outputs.${id}.stale`,
          level: "warning",
          message: `"stale" should be boolean, got ${typeof stale}`,
        });
      }

      const startedAt = entry.get("startedAt");
      const completedAt = entry.get("completedAt");
      if (startedAt != null && typeof startedAt !== "number") {
        issues.push({
          path: `outputs.${id}.startedAt`,
          level: "warning",
          message: `"startedAt" should be number (timestamp), got ${typeof startedAt}`,
        });
      }
      if (completedAt != null && typeof completedAt !== "number") {
        issues.push({
          path: `outputs.${id}.completedAt`,
          level: "warning",
          message: `"completedAt" should be number (timestamp), got ${typeof completedAt}`,
        });
      }

      // 4.3 result 结构
      const result = entry.get("result") as QueryResponse;
      if (result != null) {
        const cols = result.columns;
        const rows = result.rows;
        const rowsAffected = result.rowsAffected;
        const hasErr = "error" in result;

        if (!Array.isArray(cols) || !Array.isArray(rows) || typeof rowsAffected !== "number") {
          issues.push({
            path: `outputs.${id}.result`,
            level: "error",
            message: `Invalid QueryResponse structure for "${id}"`,
          });
        } else if (hasErr && typeof result.error !== "string") {
          issues.push({
            path: `outputs.${id}.result.error`,
            level: "warning",
            message: `"error" field should be string when present`,
          });
        }
      }
    });
  }

  return issues;
};
