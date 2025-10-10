import * as Y from "yjs";
import { CELL_ID, CELL_SOURCE } from "../core/keys";
import type { YNotebook, YCell } from "../core/types";
import { markCellOutputStale } from "../ops/execute";
import { getCellMap } from "../access/accessors";

/**
 * 工程级自动绑定器：
 *  - 监听每个 cell 的 CELL_SOURCE(Y.Text) 内容变更，置 outputs[cellId].stale=true
 *  - 监听 cell 自身的 CELL_SOURCE 引用变化（Y.Text 被替换），对新文本重新绑定
 *  - 监听 cellMap 的 add/update/delete：为新增/更新 cell 自动绑定；删除时自动清理引用
 *
 * 返回关闭函数：调用后将移除所有监听器
 */

// 已对某个 Doc 绑定过则不再重复绑定
const BOUND_DOCS = new WeakSet<Y.Doc>();

export const enableAutoStaleOnSource = (nb: YNotebook): (() => void) => {
  const doc = nb.doc as Y.Doc | undefined;
  if (!doc) {
    // 离线 Y.Map 也可以绑定，但无法做 "只绑定一次" 防护；直接继续
  } else if (BOUND_DOCS.has(doc)) {
    // 已绑定过，直接返回 no-op 关闭器
    return () => {};
  }

  // 记录所有活跃监听器，便于关闭
  const cellUnsub = new Map<YCell, () => void>(); // 解绑 cell 内部键监听
  const cellTextUnsub = new Map<YCell, () => void>(); // 解绑该 cell 当前 source 文本监听
  const idUnsub = new Map<string, () => void>(); // 基于 id 的聚合解绑（处理 cellMap 替换/删除）

  const bindText = (cell: YCell, text: Y.Text) => {
    // 若已有旧文本监听，先解绑
    const prevDispose = cellTextUnsub.get(cell);
    if (prevDispose) {
      try { prevDispose(); } catch {}
      cellTextUnsub.delete(cell);
    }

    const onTextChange = (_ev: Y.YTextEvent) => {
      const cellId = cell.get(CELL_ID);
      if (typeof cellId !== "string" || cellId.length === 0) return;
      // 任意 source 变更仅置 stale=true，不清空结果
      markCellOutputStale(nb, cellId);
    };

    text.observe(onTextChange);

    // 为该 cell 保存当前文本的解绑器
    const dispose = () => {
      try { text.unobserve(onTextChange); } catch {}
    };
    cellTextUnsub.set(cell, dispose);
  };

  const bindCell = (cell: YCell, id: string) => {
    // 监听 "CELL_SOURCE" 被替换的场景（Y.Text 对象更换）
    const onCellKeyChange = (ev: Y.YMapEvent<unknown>) => {
      if (!ev.keysChanged.has(CELL_SOURCE)) return;
      const next = cell.get(CELL_SOURCE);
      if (next instanceof Y.Text) bindText(cell, next);
      else {
        // 若新值不是 Y.Text，则解绑旧文本监听
        const prevDispose = cellTextUnsub.get(cell);
        if (prevDispose) { try { prevDispose(); } catch {} cellTextUnsub.delete(cell); }
      }
    };

    // 初次绑定当前文本
    const t = cell.get(CELL_SOURCE);
    if (t instanceof Y.Text) bindText(cell, t);

    // 监听 cell 内部键变化
    cell.observe(onCellKeyChange);

    // 为该 cell 保存解绑器
    const prev = cellUnsub.get(cell);
    cellUnsub.set(cell, () => {
      try { cell.unobserve(onCellKeyChange); } catch {}
      // 同时解绑当前文本监听
      const td = cellTextUnsub.get(cell);
      if (td) { try { td(); } catch {} cellTextUnsub.delete(cell); }
      if (prev) prev();
    });

    // 建立/替换该 id 的聚合解绑器（更新/重复绑定时先清理旧的）
    const old = idUnsub.get(id);
    if (old) { try { old(); } catch {} }
    idUnsub.set(id, () => {
      const d = cellUnsub.get(cell);
      if (d) { try { d(); } catch {} cellUnsub.delete(cell); }
      const td = cellTextUnsub.get(cell);
      if (td) { try { td(); } catch {} cellTextUnsub.delete(cell); }
    });
  };

  const cellMap = getCellMap(nb);

  // 为现存 cell 绑定
  cellMap.forEach((cell, key) => {
    if (cell instanceof Y.Map) bindCell(cell as YCell, String(key));
  });

  // 监听 cellMap 的增删改
  const onMapChange = (ev: Y.YMapEvent<YCell>) => {
    // 处理 add/update：Yjs 不区分 add/update 的 eventType，但我们从 value 判断
    ev.changes.keys.forEach((change, key) => {
      // key 是 cellId
      if (change.action === "add" || change.action === "update") {
        const cell = cellMap.get(key);
        if (cell instanceof Y.Map) bindCell(cell as YCell, String(key));
      }
      if (change.action === "delete") {
        // 基于 id 的聚合解绑（无需获取被删的 cell）
        const d = idUnsub.get(String(key));
        if (d) { try { d(); } catch {} idUnsub.delete(String(key)); }
      }
    });
  };

  cellMap.observe(onMapChange);

  // 将 doc 标记为已绑定
  if (doc) BOUND_DOCS.add(doc);

  // 返回关闭器
  const disable = () => {
    try { cellMap.unobserve(onMapChange); } catch {}
    // 先按 id 解绑聚合，再兜底清理残留
    idUnsub.forEach((dispose) => { try { dispose(); } catch {} });
    idUnsub.clear();
    cellUnsub.forEach((dispose) => { try { dispose(); } catch {} });
    cellUnsub.clear();
    cellTextUnsub.forEach((dispose) => { try { dispose(); } catch {} });
    cellTextUnsub.clear();
    if (doc) BOUND_DOCS.delete(doc);
  };

  return disable;
};
