-- Migration: Add campaign schedule and targeting fields (PostgreSQL)
-- Purpose: Add start_date_time, end_date_time, target_country, target_language
-- Created: 2026-04-20

-- PostgreSQL 迁移
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS start_date_time TIMESTAMP;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS end_date_time TIMESTAMP;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS target_country TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS target_language TEXT;

-- 添加注释
COMMENT ON COLUMN campaigns.start_date_time IS '广告系列开始时间 (ISO 8601 格式)';
COMMENT ON COLUMN campaigns.end_date_time IS '广告系列结束时间 (ISO 8601 格式)';
COMMENT ON COLUMN campaigns.target_country IS '目标国家代码 (如 US, GB, DE)';
COMMENT ON COLUMN campaigns.target_language IS '目标语言 (如 English, Spanish, German)';
