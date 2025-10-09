// Root keys
export const ROOT_NOTEBOOK_KEY = "rw-notebook-root"; // Y.Map<any>
export const SCHEMA_META_KEY = "schema-meta"; // Y.Map<{version:number, app?:string}>

// Notebook scalar/meta keys
export const NB_ID = "id";
export const NB_TITLE = "title";
export const NB_DATABASE_ID = "databaseId";
export const NB_TAGS = "tags"; // Y.Array<string>
export const NB_METADATA = "metadata"; // Y.Map<any>

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