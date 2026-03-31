-- Migration: 082_add_negative_keyword_matchtype.pg.sql
-- Purpose: Add support for negative keyword match type configuration (PostgreSQL version)
-- Date: 2025-12-18
-- Database: PostgreSQL
-- Description:
--   Google Ads API requires specifying match type for negative keywords (BROAD/PHRASE/EXACT).
--   Previously, all negative keywords were hardcoded to BROAD match, causing unintended filtering.
--   This migration adds a JSONB field to track match type for each negative keyword.
--
-- PostgreSQL-specific features used:
--   - JSONB type for efficient JSON storage and querying
--   - jsonb_object_agg() for aggregation
--   - GIN index for performance
--   - Regex operator ~ for pattern matching
--
-- Example data structure:
--   negative_keywords = ["or", "free", "how to"]
--   negative_keywords_match_type = {
--     "or": "EXACT",
--     "free": "EXACT",
--     "how to": "PHRASE"
--   }

BEGIN;

-- Add the new column to ad_creatives table
ALTER TABLE ad_creatives
ADD COLUMN IF NOT EXISTS negative_keywords_match_type JSONB DEFAULT '{}'::jsonb;

-- Initialize with default values for existing creatives
-- Strategy:
--   - Single-word negative keywords → EXACT match (防止误伤，如 "or" 不应匹配 "doorbell" 中的字母)
--   - Multi-word phrases → PHRASE match (允许词序变化，但不允许额外词)
--
-- Note: negative_keywords is stored as TEXT containing JSON array
UPDATE ad_creatives
SET negative_keywords_match_type = (
  SELECT jsonb_object_agg(
    kw,
    CASE
      WHEN kw ~ ' ' THEN 'PHRASE'::text  -- Contains space → PHRASE match
      ELSE 'EXACT'::text                  -- Single word → EXACT match
    END
  )
  FROM jsonb_array_elements_text(
    CASE
      WHEN negative_keywords IS NULL OR negative_keywords = '' THEN '[]'::jsonb
      WHEN negative_keywords = 'null' THEN '[]'::jsonb
      ELSE negative_keywords::jsonb
    END
  ) AS kw
)
WHERE negative_keywords IS NOT NULL
  AND negative_keywords != ''
  AND negative_keywords != 'null'
  AND jsonb_array_length(
    CASE
      WHEN negative_keywords IS NULL OR negative_keywords = '' THEN '[]'::jsonb
      WHEN negative_keywords = 'null' THEN '[]'::jsonb
      ELSE negative_keywords::jsonb
    END
  ) > 0;

-- Create GIN index for efficient JSONB queries
CREATE INDEX IF NOT EXISTS idx_ad_creatives_negative_keywords_match_type
ON ad_creatives USING GIN (negative_keywords_match_type);

-- Add column comment for documentation
COMMENT ON COLUMN ad_creatives.negative_keywords_match_type IS
'JSONB map of negative keywords to their match types (BROAD/PHRASE/EXACT).
Example: {"or": "EXACT", "how to": "PHRASE"}.
Prevents unintended filtering due to partial word matches.
Used by createGoogleAdsKeywordsBatch() to determine correct match type for negative keywords.';

COMMIT;
