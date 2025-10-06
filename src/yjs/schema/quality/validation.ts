import * as Y from "yjs";
import { NB_CELL_ORDER, NB_TOMBSTONES } from "../core/keys";
import { CELL_ID, CELL_KIND } from "../core/keys";
import { YNotebook, YCell } from "../core/types";
import { getCellMap, getOrder } from "../access/accessors";
import { TombstoneMetaMap, tombstoneMetaMap, isValidTombstoneClock } from "../access/tombstone";

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

  return issues;
};
