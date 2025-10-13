# 基于 Yjs、Jotai 和 React 的实时协同 Monaco Editor 引擎

## Devlogs

- [Yjs Undo 模型因“破坏性重写”导致数据重复 -> `Introduce ReconcileV2`](https://github.com/wibus-wee/console-notebook-crdt-design-test/issues/2)

## Directory Structure

```
  src/yjs/
  ├── schema/
  │   ├── core/          # 核心类型、常量、时间处理
  │   ├── access/        # 数据访问层（root, cells, outputs, tombstone）
  │   ├── ops/           # 操作层（mutations, soft_delete, execute, tombstone_maint）
  │   ├── quality/       # 质量保证（reconcile, validation, undo, auto_stale）
  │   ├── migrate/       # Schema 版本迁移框架
  │   └── bootstrap.ts   # 文档初始化
  └── jotai/            # Yjs ↔ Jotai 状态管理桥接

  tests/
  ├── schemas/          # Schema 功能测试
  ├── jotai/           # Jotai 集成测试
  └── e2e/             # 端到端测试
```