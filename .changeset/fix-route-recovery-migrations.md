---
"cloud-api": patch
---

### 修复:route recovery 迁移补齐 Postgres / MySQL,并恢复 D1 0022 真实建列

修复此前 route 失败自动禁用 / 24h 自动恢复功能(0022/0023)只写了 D1、且 D1 0022 被改成 no-op 占位导致的问题:

- **D1**:恢复 `0022_auto_route_recovery.sql` 为真实 `ADD COLUMN`(`consecutive_failures` / `disabled_at`)。已手动加过列的现有库不受影响(d1_migrations 按文件名去重,不会重复执行);全新库可直接 `npm run db:migrate` 建出这两列,避免 0023 的 `CREATE INDEX ... ON model_routes(disabled_at)` 因列不存在而失败。
- **Postgres**:新增 `0022_auto_route_recovery.sql`(幂等 `ADD COLUMN IF NOT EXISTS`)与 `0023_route_recovery_columns.sql`(partial index),补齐此前缺失的路由恢复列与索引。
- **MySQL**:新增 `0022_auto_route_recovery.sql`(`INT` / `DATETIME` 列)与 `0023_route_recovery_columns.sql`(普通索引,MySQL 无 partial index)。
