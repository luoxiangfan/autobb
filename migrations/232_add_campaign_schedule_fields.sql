-- Migration: Add campaign schedule and targeting fields
-- Purpose: Add start_date_time, end_date_time, target_country, target_language
-- Created: 2026-04-20

-- SQLite 迁移
ALTER TABLE campaigns ADD COLUMN start_date_time TEXT; -- 广告系列开始时间 (ISO 8601 格式)
ALTER TABLE campaigns ADD COLUMN end_date_time TEXT; -- 广告系列结束时间 (ISO 8601 格式)
ALTER TABLE campaigns ADD COLUMN target_country TEXT; -- 目标国家代码 (如 US, GB, DE)
ALTER TABLE campaigns ADD COLUMN target_language TEXT; -- 目标语言 (如 en)
