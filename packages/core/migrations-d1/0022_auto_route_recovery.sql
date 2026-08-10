-- Auto-route recovery: track failures and auto-re-enable after 24 hours
-- consecutive_failures: incremented on each upstream failure, reset to 0 on success
-- disabled_at: set when route is auto-disabled (consecutive_failures >= 3), NULL when active

ALTER TABLE model_routes ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE model_routes ADD COLUMN disabled_at TEXT DEFAULT NULL;

-- Index for efficient auto-recovery queries
CREATE INDEX idx_model_routes_disabled_at ON model_routes(disabled_at) WHERE disabled_at IS NOT NULL;
