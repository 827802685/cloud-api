-- Auto 模型选择权重：值越大，auto 模式越优先使用该模型（默认 0）。
ALTER TABLE models ADD COLUMN auto_weight INT NOT NULL DEFAULT 0;
