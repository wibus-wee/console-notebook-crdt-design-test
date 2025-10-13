import * as Y from "yjs";
import { NB_OUTPUTS } from "../core/keys";
import type { YOutputsMap, YOutputEntry } from "../core/types";

/** 顶层 Outputs 容器：Y.Map<cellId, YOutputEntry> */
export const getOutputsMap = (nb: Y.Map<any>): YOutputsMap => {
  let m = nb.get(NB_OUTPUTS) as YOutputsMap | undefined;
  if (!m) {
    m = new Y.Map<YOutputEntry>();
    nb.set(NB_OUTPUTS, m);
  }
  return m;
};

/** 获取某个 cell 的输出记录（不存在则返回 undefined，不创建） */
export const getOutputEntry = (nb: Y.Map<any>, cellId: string): YOutputEntry | undefined => {
  if (!cellId || typeof cellId !== "string") {
    throw new Error(`Invalid cellId: ${cellId}`);
  }
  const m = nb.get(NB_OUTPUTS) as YOutputsMap | undefined;
  if (!m) return undefined;
  return m.get(cellId);
};

/** 确保某个 cell 的输出记录存在（必要时创建空骨架） */
export const ensureOutputEntry = (nb: Y.Map<any>, cellId: string): YOutputEntry => {
  const m = getOutputsMap(nb);
  let e = m.get(cellId);
  if (!(e instanceof Y.Map)) {
    e = new Y.Map();
    // 初始骨架：running/stale 显式化，其他字段按需补充
    e.set("running", false);
    e.set("stale", false);
    m.set(cellId, e);
  }
  return e;
};
