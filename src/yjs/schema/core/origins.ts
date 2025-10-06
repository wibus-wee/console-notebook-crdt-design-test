export const USER_ACTION_ORIGIN = Symbol("USER_ACTION"); // 用户触发操作（可撤销）
export const VACUUM_ORIGIN = Symbol("VACUUM"); // 清理操作（不可撤销）
export const MAINT_ORIGIN = Symbol("MAINTENANCE"); // 维护/修复（不可撤销）

