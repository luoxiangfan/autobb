-- Migration: 037_add_keywords_columns_to_ad_creatives (PostgreSQL)
-- Description: 添加keywords_with_volume和negative_keywords列到ad_creatives表
-- Created: 2025-12-03
-- Reason: 代码需要存储带搜索量的关键词和否定关键词

-- 添加keywords_with_volume列（存储带搜索量信息的关键词JSON）
ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS keywords_with_volume TEXT DEFAULT NULL;

-- 添加negative_keywords列（存储否定关键词JSON数组）
ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS negative_keywords TEXT DEFAULT NULL;

-- 添加explanation列（创意生成说明）
ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS explanation TEXT DEFAULT NULL;
