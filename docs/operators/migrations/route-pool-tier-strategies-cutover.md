# 按层路由策略（迁移 0018）

为 `route_pools` 增加可空列 **`tier_strategies`**（TEXT JSON），允许同一 Pool 内不同 `priority` 层使用不同的同层排序策略（`cache_affinity` / `weighted_random` / `fixed_order` / `weighted_round_robin`）。

**迁移文件**（三库同语义）：

- `packages/core/migrations-d1/0018_route_pool_tier_strategies.sql`
- `packages/core/migrations-postgres/0018_route_pool_tier_strategies.sql`
- `packages/core/migrations-mysql/0018_route_pool_tier_strategies.sql`

**行为说明**：[route-strategies.md](../../developers/reference/route-strategies.md) · [route-topology.md](../../developers/architecture/route-topology.md)

---

## 1. 兼容性

- 列为空 / `NULL` 时行为与改造前完全一致（所有层共用 Pool / 模型 / 全局策略）。
- **无需数据回填**。
- Proxy 在列缺失时读到 `undefined` → 空 Map → 回退旧逻辑，允许先部署代码再迁移（或先迁移再部署）。

---

## 2. 应用迁移

按当前部署模式选一（仓库根）：

```bash
# D1 local / remote
npm run db:migrate

# Postgres / MySQL（见 packages/core migrate CLI）
npm run db:migrate:postgres
# 或
npm run db:migrate:mysql
```

校验：

```sql
-- D1 / SQLite
PRAGMA table_info(route_pools);

-- Postgres
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'octafuse_gateway' AND table_name = 'route_pools';
```

应出现 `tier_strategies`。

---

## 3. 验收

1. Admin Routes 流程图：POLICY 卡片已移除；每个 P{n} 层头部有策略 chip。
2. 点击层策略 → 弹窗可设置「本层策略」与折叠的「路由池默认」。
3. 保存后 `GET /api/admin/routes` 对应行的 `pool_tier_strategies` 含 JSON map。
4. 层间「Failover 规则」链接打开只读说明弹窗。
5. Proxy：同一 Pool 配置 `{"10":"fixed_order","0":"weighted_random"}` 后，高 / 低层应分别按对应策略排序（可用单测 `buildRouteAttemptPlan` 覆盖）。

---

## 4. 回滚

若需回滚应用代码：旧 Proxy / Admin 忽略未知列，读路径仍用 `route_pools.strategy`。

若需删列（一般不必要）：

```sql
-- Postgres
ALTER TABLE route_pools DROP COLUMN IF EXISTS tier_strategies;

-- MySQL / D1：按引擎语法 DROP COLUMN（注意备份）
```
