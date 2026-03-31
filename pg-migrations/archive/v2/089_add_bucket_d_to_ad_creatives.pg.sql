-- Migration: Add Bucket D to ad_creatives keyword_bucket constraint (PostgreSQL)
-- Date: 2025-12-22
-- Description: Updates CHECK constraint to support 'D' bucket in addition to 'A', 'B', 'C', 'S'

-- PostgreSQL supports ALTER TABLE DROP/ADD CONSTRAINT
ALTER TABLE ad_creatives
DROP CONSTRAINT IF EXISTS ad_creatives_keyword_bucket_check;

ALTER TABLE ad_creatives
ADD CONSTRAINT ad_creatives_keyword_bucket_check
CHECK (keyword_bucket IN ('A', 'B', 'C', 'D', 'S'));
