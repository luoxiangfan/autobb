-- Migration: Add ad_creative_id to campaign_backups table
-- Purpose: Store the ad creative ID used for campaign creation
-- Created: 2026-04-23

-- SQLite 迁移
ALTER TABLE campaign_backups ADD COLUMN ad_creative_id INTEGER; -- 创建广告系列时使用的广告创意 ID

-- 添加索引加速查询
CREATE INDEX IF NOT EXISTS idx_campaign_backups_ad_creative_id ON campaign_backups(ad_creative_id);
