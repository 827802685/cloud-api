-- Auto-route recovery: track failures and auto-re-enable after 24 hours
-- consecutive_failures: incremented on each upstream failure, reset to 0 on success
-- disabled_at: set when route is auto-disabled (consecutive_failures >= 3), NULL when active
--
-- NOTE: 该迁移会在全新数据库上真正添加这两列。若你的库已经手动添加过
-- （例如线上 D1 手工 ALTER 过），此迁移不会重复执行——d1_migrations 会按
-- 文件名去重，已应用过本文件的库会直接跳过，因此无需担心重复建列。

ALTER TABLE model_routes ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE model_routes ADD COLUMN disabled_at TEXT DEFAULT NULL;
