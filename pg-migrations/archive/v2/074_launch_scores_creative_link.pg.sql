-- Migration 074: Link launch_scores to ad_creatives and add issues/suggestions storage
-- Date: 2025-12-17
-- Purpose:
--   1. Associate Launch Score with specific ad creative for caching
--   2. Store issues and suggestions for display without recalculation

-- Add ad_creative_id column to link with specific creative
ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS ad_creative_id INTEGER REFERENCES ad_creatives(id) ON DELETE SET NULL;

-- Add issues column to store array of issues (JSON)
ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS issues TEXT;

-- Add suggestions column to store array of suggestions (JSON)
ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS suggestions TEXT;

-- Add content_hash to detect if creative content has changed (for cache invalidation)
ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Add campaign_config_hash to detect if campaign config has changed
ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS campaign_config_hash TEXT;

-- Create index for quick lookup by creative_id
CREATE INDEX IF NOT EXISTS idx_launch_scores_creative_id ON launch_scores(ad_creative_id);

-- Create unique index to ensure one launch_score per creative+config combination
-- PostgreSQL supports partial unique indexes with WHERE clause
CREATE UNIQUE INDEX IF NOT EXISTS idx_launch_scores_creative_config
ON launch_scores(ad_creative_id, content_hash, campaign_config_hash)
WHERE ad_creative_id IS NOT NULL AND content_hash IS NOT NULL;

-- Update existing records: set content_hash to NULL (will be recalculated on next evaluation)
-- No data migration needed as existing records don't have creative associations
