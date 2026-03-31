-- Migration: 082_add_negative_keyword_matchtype.sql
-- Purpose: Add support for negative keyword match type configuration
-- Date: 2025-12-18
-- Description:
--   Google Ads API requires specifying match type for negative keywords (BROAD/PHRASE/EXACT).
--   Previously, all negative keywords were hardcoded to BROAD match, causing unintended filtering.
--   SQLite版本：使用 TEXT 存储 JSON（与现有 negative_keywords 字段一致）。
--
-- Example:
--   negative_keywords = ["or", "free", "how to"]
--   negative_keywords_match_type = {"or":"EXACT","free":"EXACT","how to":"PHRASE"}

-- Add the new column (SQLite: JSON stored as TEXT)
ALTER TABLE ad_creatives
ADD COLUMN negative_keywords_match_type TEXT DEFAULT '{}';

-- Optional index (TEXT index for quick filtering/debug; SQLite 无 GIN)
CREATE INDEX IF NOT EXISTS idx_ad_creatives_negative_keywords_match_type
ON ad_creatives(negative_keywords_match_type);
