-- Migration 245: persist offer extraction mode (fast / balanced / original)
ALTER TABLE offers ADD COLUMN extraction_mode TEXT DEFAULT 'original'; -- Offer 提取模式：fast | balanced | original
