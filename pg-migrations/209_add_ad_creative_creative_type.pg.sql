-- Migration: 209_add_ad_creative_creative_type.pg.sql
-- Date: 2026-03-16
-- Description: 为 ad_creatives 增加 canonical creative_type 字段（PostgreSQL）

ALTER TABLE ad_creatives
  ADD COLUMN IF NOT EXISTS creative_type TEXT;

CREATE INDEX IF NOT EXISTS idx_ad_creatives_creative_type
  ON ad_creatives(creative_type);
