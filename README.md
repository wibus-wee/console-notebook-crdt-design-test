# 基于 Yjs、Jotai 和 React 的实时协同 Monaco Editor 引擎

## Known Issues

- [ ] Yjs Undo 在“用户 move 后，再有其它对同一 Y.Array 的 interleaving 修改（即便 MAINT_ORIGIN 未被追踪）”时，撤销语义对时序较敏感，容易出现非预期重复。

  测试范围与用例建议

  - 基础引导与模型
      - ensureNotebookInDoc 初始化
          - 缺省字段填充：id/title/databaseId/tags/metadata 默认值正确。
          - 结构保证：cellMap/order/tombstones/tombstoneMeta 均存在。
          - 初始 order 种子：去重插入，不重复。
          - 已有 cell 被 lock：后续尝试 cell.set('id', ...) 会被重置。
          - 文件: src/yjs/schema/bootstrap.ts:20
      - yCellToModel / yNotebookToModel
          - Y.Text 转字符串；metadata 默认值；非字符串 id/kind 警告但能容错。
          - 文件: src/yjs/schema/access/conversion.ts:29, src/yjs/schema/access/conversion.ts:57
  - Map+Order 变更操作
      - insertCell
          - 先 map.set 再 order.insert；重复 id 先移除旧位再插入到新位。
          - 插入边界 index < 0 / > length 的裁剪行为。
          - 文件: src/yjs/schema/ops/mutations.ts:9
      - removeCell
          - 从 order 全部删除该 id；从 map 删除；清除 tombstones 和 tombstoneMeta 对应项。
          - 文件: src/yjs/schema/ops/mutations.ts:45
      - moveCell
          - 边界 toIndex；不移动时不产生变更；从末位移到末尾无操作。
          - 文件: src/yjs/schema/ops/mutations.ts:73
  - 软删、恢复、清理
      - softDeleteCell
          - 从 order 移除；tombstones 设置为 true；tombstoneMeta 写入 reason/deletedAt/clock。
          - timestamp/clock 逻辑：未传 timestamp 时使用时钟；小于楼层时间拒绝写入。
          - 文件: src/yjs/schema/ops/soft_delete.ts:14
      - restoreCell
          - 恢复至指定 index；清除 tombstones 与 tombstoneMeta。
          - 文件: src/yjs/schema/ops/soft_delete.ts:52
      - setTombstoneTimestamp
          - 未有 tombstone flag 时也会置为 true；clock 可信/本地标记。
          - 文件: src/yjs/schema/ops/tombstone_maint.ts:17
      - vacuumNotebook
          - 仅在 “受信任时钟 + TTL 满足 + 不在 order” 时才会删除实体与 meta；“local” 时钟或 TTL 未到都不清理。
          - 未来时间漂移保护（maxFutureSkew）有效。
          - 文件: src/yjs/schema/ops/tombstone_maint.ts:41
  - 校验与修复
      - validateNotebook
          - order 引用缺失 id 报 error；重复 id 报 error；order 中 tombstone 报 warning。
          - map 中孤立 id 报 warning；cell 缺少 kind 报 error；key 与嵌入 id 不一致报 warning。
          - 文件: src/yjs/schema/quality/validation.ts:15
      - reconcileNotebook
          - 去重：保留首个，移除后续重复。
          - 清理：移除缺失于 map、tombstoned 的 id；非字符串一律移除；空字符串按 flag 保留或移除。
          - 孤儿追加：map 中非 tombstone 且不在 order 的 id 追加到末尾；默认按 id 升序；开关可关。
          - 不改变时 changed=false；报告各统计字段正确。
          - 事务与撤销：变更使用 MAINT_ORIGIN，UndoManager 不追踪（结合撤销测试验证）。
          - 文件: src/yjs/schema/quality/reconcile.ts:29
  - Undo 管理
      - createNotebookUndoManager
          - USER_ACTION_ORIGIN 的 insert/remove/move/softDelete 可撤销；MAINT_ORIGIN（reconcile）与 VACUUM_ORIGIN 不进入撤
            销栈。
          - 连续事务合并（captureTimeout）行为正确。
          - 文件: src/yjs/schema/quality/undo.ts:10
  - 迁移框架
      - migrateNotebookSchema
          - 当前版本等于 SCHEMA_VERSION：打印 up-to-date；autoReconcile=true 时执行一次 reconcile 并校验日志与 validate 结
            果。
          - 版本落后：按注册表逐步迁移；每步事务内“版本重检”能在并发推进时跳过重复迁移体。
          - 版本超前：提示 Warning 并退出。
          - 文件: src/yjs/schema/migrate/migrate.ts:9
      - registerNotebookMigration
          - 重复注册抛错；按 fromVersion 链式执行。
          - 文件: src/yjs/schema/migrate/registry.ts:19
  - ID Guard（锁）
      - lockCellId
          - 对未附着到 Doc 的 cell：直接 set id 会被 observe 逻辑同步重置为锁定值。
          - 对附着 Doc 的 cell：set id 会在 doc.transact(reset, CELL_ID_GUARD_ORIGIN) 下回滚，且不进入 Undo 栈。
          - 文件: src/yjs/schema/access/cells.ts
  - 属性测试（可选，高价值）
      - 基于 fast-check 生成一系列随机操作（insert/move/remove/softDelete/restore + 手工注入“脏 order”），断言
          - validate 的 error 不为正（或只在注入脏数据时出现）
          - reconcile 之后 validate 没有 error，且 order 与 map 引用一致
      - 强化对复杂分支的覆盖（尤其 reconcile 和 vacuum 的判定）

  测试组织与工具建议

  - 测试框架
      - 推荐 Vitest（与 Vite 生态一致）
      - 套件：vitest、@types/node、覆盖率 @vitest/coverage-v8
      - 脚本："test": "vitest", "test:run": "vitest run", "test:cov": "vitest run --coverage"
  - 目录结构
      - tests/helpers/yjs.ts：构造 Y.Doc、ensureNotebookInDoc、快捷获取 map/order/tomb maps 的工具。
      - tests/schema/
          - reconcile.test.ts
          - validation.test.ts
          - mutations.test.ts
          - soft_delete_restore.test.ts
          - vacuum.test.ts
          - undo.test.ts
          - migrate.test.ts
          - id_guard.test.ts
          - conversion.test.ts
  - 基本测试模式
      - 每个测试创建独立 new Y.Doc()；调用 ensureNotebookInDoc(doc)；用 ops/quality 方法驱动状态；断言 order.toArray()、
        map.has(id) 和 validateNotebook 输出。

  示例用例片段（示意）

  - reconcile 去重 + 孤儿追加
      - tests/schema/reconcile.test.ts
          - 创建 doc 和 nb；构造 map.set(a,b) 两个 cells，但 order 只包含 a 两次和一个无效值 0；将 b 标为 orphan；调用
            reconcileNotebook，断言：
              - changed === true
              - order 最终为 [a, b]（无重复 + orphan 追加）
              - removedDuplicates、removedInvalid 正确计数
  - softDelete + restore + vacuum
      - tests/schema/soft_delete_restore.test.ts
          - 插入 cell x；softDeleteCell(nb, x) 后 order 不包含 x，tombstones.get(x) === true
          - restoreCell(nb, x, 0) 后 order[0] === x 且 tombstones/tombstoneMeta 已清理
      - tests/schema/vacuum.test.ts
          - softDeleteCell 后手动 setTombstoneTimestamp 为（trusted 且 ts=now-ttl-1）
          - vacuumNotebook 后 map.has(x) === false 且 tombstoneMeta/tombstones 均清理
  - UndoManager 与 origin 过滤
      - tests/schema/undo.test.ts
          - 对 insertCell / moveCell 执行 USER_ACTION_ORIGIN 操作，undo() 能回滚
          - 调用 reconcileNotebook（MAINT_ORIGIN），undo() 不应回滚 reconcile 的变化
  - 迁移并发重检（单机模拟）
      - tests/schema/migrate.test.ts
          - 预设 meta.version=v1；注册一个迁移(step1→2) 将某字段设为 X
          - 模拟并发：在一次 migrateNotebookSchema(doc) 调用之前先手动把 version 设置为 target（模拟他端推进），再执行迁移；
            断言迁移体被跳过（字段未被重复写入），日志包含 skip 提示

  注意点

  - 时钟与时间
      - 使用可控的 ClockSource 注入 softDeleteCell、setTombstoneTimestamp、vacuumNotebook，避免依赖系统时间导致测试不稳定。
  - 事务与事件
      - 尽量在每个测试中使用 doc.transact 收拢多写入，减少不必要的中间状态和事件。
  - 性能与隔离
      - 每个测试独立 Doc，避免状态泄漏；清理监听器由 Yjs 自动处理，无需额外 teardown。
