-- Auto-route recovery: track failures and auto-re-enable after 24 hours
-- consecutive_failures: incremented on each upstream failure, reset to 0 on success
-- disabled_at: set when route is auto-disabled (consecutive_failures >= 3), NULL when active

ALTER TABLE model_routes ADD COLUMN consecutive_failures INT NOT NULL DEFAULT 0;
ALTER TABLE model_routes ADD COLUMN disabled_at DATETIME NULL;
