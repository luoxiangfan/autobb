-- Migration 245: persist offer extraction mode (fast / balanced / original) (PostgreSQL)
-- Default: original (完整提取)

ALTER TABLE offers ADD COLUMN IF NOT EXISTS extraction_mode TEXT DEFAULT 'original';

COMMENT ON COLUMN offers.extraction_mode IS 'Offer 提取模式：fast | balanced | original';
