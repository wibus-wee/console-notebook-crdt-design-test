# 基于 Yjs、Jotai 和 React 的实时协同 Monaco Editor 引擎

## Known Issues

- [ ] Yjs Undo 在“用户 move 后，再有其它对同一 Y.Array 的 interleaving 修改（即便 MAINT_ORIGIN 未被追踪）”时，撤销语义对时序较敏感，容易出现非预期重复。

下面是一个“工程完备”的 Reconcile 全新设计方案（不写代码，聚焦深度设计、可落地性与可验证性），目标是在保证一致性修复的同时，彻底避开 Undo 栈被破坏的问题，并对可观测性、测试、性能与演进留出余量。

目标与范围

目标
恢复 Notebook order 与 cellMap、tombstones 的一致性。
保持已有元素的 Yjs Item 身份（避免整段重写导致 Undo 栈失效）。
幂等、可配置、可观测，默认“不惊动用户”（不进入撤销栈）。
非目标
不改变用户语义的“内容顺序”，除非修复所需（去重/剔除无效）或明确 opt-in 的重排策略。
不做业务层的排序/分组；仅做结构一致性修复。
API 设计

函数签名
reconcileNotebook(nb: YNotebook, opts?: ReconcileOptions): ReconcileReport
ReconcileOptions（建议）
appendOrphans: boolean 默认 true
sortOrphansById: boolean | ((a: string, b: string) => number) 默认 true（字典序）；支持自定义 comparator
dropTombstonedFromOrder: boolean 默认 true
dropInvalidOrderEntries: boolean 默认 true（非 string、空字符串、或缺失于 map 的 id 均视为非法）
preserveRelativeOrderOfKept: boolean 默认 true（保留“保留项”的相对顺序）
strategy: 'minimal-diff' | 'rebuild' 默认 'minimal-diff'
patchBudget?: { maxDeletes?: number; maxInserts?: number } 允许在极端情况下切换策略（详见降级）
dryRun?: boolean 仅返回计划与报告，不落地
validateAfter?: boolean 落地后可选做一次 validate 并回传 issues
ReconcileReport（建议）
原有字段保留：changed, previousOrderLength, finalOrderLength, removedMissingFromMap, removedTombstoned, removedDuplicates, removedInvalid, appendedOrphans
新增字段（建议）：
patch, patchStats: 最终执行的“最小差异补丁”与统计（删除/插入段数）
strategyUsed: 'minimal-diff' | 'rebuild'
dryRun: boolean
validationIssues?: ValidationIssue[]
warnings?: string[]（如 patch 超预算、fallback 等事件）
语义与不变量

不变量
Order 内仅有 string 且非空的 id
Order 中无重复 id
Order 中的 id 必须存在于 cellMap
若 dropTombstonedFromOrder=true，Order 不包含 tombstoned id
若 appendOrphans=true，map 中（非 tomb）但不在 Order 的 id 必须在末尾追加
幂等性
对任一状态运行一次 Reconcile 后，再次运行应为 no-op（changed=false）
相对顺序
preserveRelativeOrderOfKept=true 时，“保留项”的相对顺序不变化（仅删除/追加）
事务 origin
默认使用 MAINT_ORIGIN，与用户栈隔离；不进入 UndoManager 的 trackedOrigins（若仅包含 USER_ACTION）
算法：最小差异策略（核心）

概览
避免 “delete(0,len)+insert(0,next)” 的整段重写
仅删除具体无效/重复/被 tombstoned 的项；仅向末尾 append 孤儿
按索引降序执行删除以稳定索引；连续索引段合并为一次 delete 操作
孤儿一次性 push/insert 到尾部（可排序）
步骤
读取快照 before = order.toArray()；建立集合：
seen = new Set<string>()；tombSet；mapIds（遍历 cellMap）
遍历 before，计算：
invalid: 非 string；空字符串（视配置）；missing: 不在 map；dup: seen 已含；tomb: 在 tombSet 且配置丢弃
对以上标记为删除；对“首个合规项”加入 kept & seen
生成删除计划：将待删索引压缩为最少 delete 段（降序执行）
生成孤儿：orphans = mapIds - kept - tomb；按 sortOrphansById 排序；末尾 append
如果 dryRun，仅返回计划；否则在单个 doc.transact(MAINT_ORIGIN) 中执行删除段与 append
复杂度
时间 O(n + m)，n 为 order 长度，m 为 map 大小；删除与追加为 O(k)，k 为删除段数量与追加段数量
空间 O(n + m) 级别
回退与降级（工程韧性）

若 minimal-diff 失败（极少数因并发导致状态突变）：
事务内先执行再验证；失败则二次重试（再读快照 → 动态重算），最多 1 次
若仍失败且配置允许（strategy='rebuild' 或 patch 超预算 patchBudget），才执行“重建”策略
重建策略默认禁用；若启用，必须按产品策略处置 Undo：a) 将 MAINT_ORIGIN 纳入 trackedOrigins；或 b) 维护后清空 Undo 栈；或 c) 仅在无 UndoManager 或 doc-less 时使用
与 Undo/Redo 的关系

通过“最小差异 + 不移动/不重建”保持 Item 身份，Undo 栈不被破坏
统一在单个 doc.transact(MAINT_ORIGIN) 内执行，便于 UndoManager 过滤
若产品确需“排序重排”功能（会移动 kept），应为独立 opt-in 选项，并明确提示可能影响 Undo；或暂缓到 UI 层
并发与一致性

事务化：读取、计算、落地尽量在一个 doc.transact 内完成
二次校验：落地后按不变量快速校验；若失败按降级方案处理
多终端收敛：appendOrphans 的排序使用确定性比较（默认字典序），保证跨端一致
性能与可观测性

合并删除段以减少操作次数
收集 patchStats（段数、删除/插入数量）与 warnings（回退、超预算）
可选 validateAfter=true 时返回校验结果，方便上层监控
错误与 doc-less 兼容

doc-less 模式：仍可执行 Y.Map/Y.Array 原子操作，但避免依赖 Y.Text 等需要挂 doc 的类型
若 doc 不存在，直接执行 apply（不 transact）；仍返回报告
捕获并包装异常为 report.warnings，避免抛出破坏上层业务
测试设计（面向工程完备）

单元
去重：保留首个、删后续；不改变 kept 相对顺序
非法/缺失/tomb：删除对应项；配置关闭时保留并报告
孤儿：追加到末尾；默认排序；sort=false 时仅断言集合相等
幂等：运行两次第二次为 no-op
事务 origin：变更事件 origin 为 MAINT_ORIGIN
doc-less：在不挂 doc 的 nb 上工作（仅数组/映射），不抛错（报告 changed）
集成
Undo 场景：用户 move/insert 后运行 reconcile 最小差异；undo 应仅回滚用户动作，无重复项
并发：另一事务并发插入一个合法 id；reconcile 后不丢失此 id
大量数据：随机生成无效/重复/孤儿分布，校验不变量与幂等
E2E
与 softDelete/restore/vacuum/validation 的联动：reconcile 不应破坏这些流程
迁移与兼容

默认启用 strategy='minimal-diff'，与现有行为兼容（不改变用户可见顺序），只减少“整段重写”
保留现有 Options 语义；新增选项有后向兼容默认值
若已有依赖“整段重写”的上层逻辑（极少见），可通过 strategy='rebuild' 显式启用
后续扩展

可提供 compare(a,b) 钩子，用于自定义 orphan 排序或未来的“稳定重排”模式
提供 onPatch?(patch) 回调，用于 UI 侧可视化修复过程或遥测
提供 reconcileScope 选项，细化仅处理某些子区间或白名单 id
总结

根本性改进在于“最小差异”的补丁策略，避免整段重写，从而保护 Undo 栈与用户体验。
边界场景通过“二次校验 + 降级回退 + 预算控制”增强韧性。
配合完善的测试矩阵、可观测性与迁移策略，可以在不牺牲一致性修复能力的前提下，实现工程上可落地、可演进、对用户无感的 Reconcile。

参考文档

- Yjs Notebook Schema 设计与操作总览：docs/yjs-schema-design.md


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
