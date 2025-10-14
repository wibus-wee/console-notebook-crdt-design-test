import { ulid } from "ulid";
import { EXECUTION_ORIGIN } from "../core/origins";
import type { YNotebook } from "../core/types";
import { getOutputsMap, ensureOutputEntry } from "../access/outputs";
import type { QueryResponse } from "../../api-gen-type";
import { withTransactOptional } from "../core/transaction";

/** 启动执行：重置并标记 running=true */
export const startExecuteCell = (
  nb: YNotebook,
  cellId: string,
  opts?: { now?: number }
) => {
  const apply = () => {
    const entry = ensureOutputEntry(nb, cellId);
    const runId = ulid();
    const now = opts?.now ?? Date.now();

    // 覆盖基础运行态
    entry.set("running", true);
    entry.set("stale", false);
    entry.set("startedAt", now);
    entry.set("runId", runId);
    entry.delete("completedAt");
  };
  withTransactOptional(nb, apply, EXECUTION_ORIGIN);
};

/** 应用执行结果（完全覆盖旧 result） */
export const applyExecuteResult = (
  nb: YNotebook,
  cellId: string,
  result: QueryResponse,
  opts?: {
    completedAt?: number;
    /** 期待匹配的 runId；用于并发守门 */
    expectedRunId?: string;
    /** 忽略 runId 校验，强制写入（谨慎使用） */
    ignoreRunId?: boolean;
    /** 应用完成后是否清除 runId（默认 true，避免重复写入） */
    clearRunId?: boolean;
  }
) => {
  const apply = () => {
    const outputs = getOutputsMap(nb);
    const entry = outputs.get(cellId);
    // 没有活跃/历史 entry 时，不创建新 entry，直接忽略（避免孤儿结果）
    if (!entry) return;

    // 并发守门：若存在 runId，默认要求与 expectedRunId 匹配才会写入
    if (!opts?.ignoreRunId) {
      const currentRunId = entry.get("runId") as string | undefined;
      const expected = opts?.expectedRunId;

      // 情况 A：entry 有 runId，但上层未提供 expected —— 不写入（无法确认归属）
      if (currentRunId && !expected) return;
      // 情况 B：entry 无 runId，但上层提供了 expected —— 不写入（说明 run 已被结束/清理）
      if (!currentRunId && expected) return;
      // 情况 C：两者都存在但不相等 —— 不写入（旧结果）
      if (currentRunId && expected && currentRunId !== expected) return;
    }

    const now = opts?.completedAt ?? Date.now();

    entry.set("running", false);
    entry.set("stale", false);
    entry.set("completedAt", now);
    entry.set("result", result);

    // 默认清除 runId，避免后续重复结果再次落地
    const shouldClear = opts?.clearRunId ?? true;
    if (shouldClear) entry.delete("runId");
  };
  withTransactOptional(nb, apply, EXECUTION_ORIGIN);
};

/**
 * 内部便捷方法：使用当前 entry 中的 runId 作为 expectedRunId 进行结果提交。
 * 不暴露 runId 给调用方，若当前没有 runId（未 start 或已清理）则忽略提交。
 */
export const applyExecuteResultForCurrentRun = (
  nb: YNotebook,
  cellId: string,
  result: QueryResponse,
  opts?: { completedAt?: number; ignoreRunId?: boolean; clearRunId?: boolean }
) => {
  const outputs = getOutputsMap(nb);
  const entry = outputs.get(cellId);
  const expectedRunId = entry?.get("runId") as string | undefined;
  if (!expectedRunId && !opts?.ignoreRunId) return;
  applyExecuteResult(nb, cellId, result, { ...opts, expectedRunId });
};

/** 源修改时标记 stale=true */
export const markCellOutputStale = (
  nb: YNotebook,
  cellId: string,
  opts?: { origin?: symbol }
) => {
  const apply = () => {
    const outputs = getOutputsMap(nb);
    const entry = outputs.get(cellId);
    if (!entry) return;
    const current = entry.get("stale");
    if (current === true) return;
    entry.set("stale", true);
  };
  withTransactOptional(nb, apply, opts?.origin ?? EXECUTION_ORIGIN);
};
