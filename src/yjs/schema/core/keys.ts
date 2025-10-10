// Root keys
export const ROOT_NOTEBOOK_KEY = "rw-notebook-root"; // Y.Map<any>
export const SCHEMA_META_KEY = "schema-meta"; // Y.Map<{version:number, app?:string}>

// Notebook scalar/meta keys
export const NB_ID = "id";
export const NB_TITLE = "title";
export const NB_DATABASE_ID = "databaseId";
export const NB_TAGS = "tags"; // Y.Array<string>
export const NB_METADATA = "metadata"; // Y.Map<any>

// 与正文（NB_CELL_MAP）解耦，UndoManager 默认就不会追踪；
// removeCell() 时容易一并清理（或由 vacuum 做延迟清理）；
// 打开 Notebook 时“一次性加载 outputs”只需要读一个 Map。
export const NB_OUTPUTS = "outputs"; // Y.Map<Y.Map<any>>
// outputs.get(cellId) -> Y.Map<any>  (值类型固定，但以 Y.Map 存，方便部分字段小改)
// {
//   running: boolean,        // 是否正在执行（协同广播）
//   stale: boolean,          // 与 source 不匹配时置 true，执行成功后置 false
//   startedAt?: number,      // 本次执行开始时间（本地或受信时钟）
//   completedAt?: number,    // 结果完成写入时间
//   runId?: string,          // 本次运行的标识（ULID），用于并发守门
//   // 固定结构的查询结果，整块覆盖：
//   result?: QueryResponse,  // { columns, rows, rowsAffected, error? }
// }
// Q: 如果把 output 放进 YCell 里呢？
// A: UndoManager 的 scope 正在追踪 NB_CELL_MAP，虽然我们可以靠 EXECUTION_ORIGIN 规避
//    但后续很容易被误加跟踪导致“撤销把输出也回滚”。
//    同时，cell 变得臃肿，序列化/迁移/重构时更容易相互牵连。

// Notebook cell storage (Map + Order)
export const NB_CELL_MAP = "cellMap"; // Y.Map<YCell>
export const NB_CELL_ORDER = "order"; // Y.Array<string>

// Tombstone（软删除标记 + 元信息）
export const NB_TOMBSTONES = "tombstones"; // Y.Map<boolean> (cellId -> true)
export const NB_TOMBSTONE_META = "tombstoneMeta"; // Y.Map<string, Y.Map<any>>

// Cell keys
export const CELL_ID = "id";
export const CELL_KIND = "kind"; // 'sql' | 'markdown'
export const CELL_SOURCE = "source"; // Y.Text
export const CELL_META = "metadata"; // Y.Map<any> (仅浅层)
export const CELL_FINGERPRINT = "fingerprint"; // string (哈希) 当前代码版本哈希
export const CELL_EXEC_BY = "executedBy"; // userId (last runner)