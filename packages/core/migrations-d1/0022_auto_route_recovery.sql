-- Auto-route recovery: track failures and auto-re-enable after 24 hours
-- consecutive_failures: incremented on each upstream failure, reset to 0 on success
-- disabled_at: set when route is auto-disabled (consecutive_failures >= 3), NULL when active
-- NOTE: columns added idempotently via migration 0023 if not already present

-- This migration is a no-op placeholder. The columns were added directly to the database.
-- See migration 0023 for the idempotent version.
SELECT 1;
