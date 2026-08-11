-- Route recovery index (idempotent)
SET search_path TO octafuse_gateway;

CREATE INDEX IF NOT EXISTS idx_model_routes_disabled_at
  ON model_routes(disabled_at)
  WHERE disabled_at IS NOT NULL;
