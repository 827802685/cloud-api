-- Route recovery index (MySQL has no partial indexes; simple index on disabled_at)
CREATE INDEX idx_model_routes_disabled_at ON model_routes(disabled_at);
