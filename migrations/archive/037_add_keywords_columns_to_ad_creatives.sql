-- Migration: 037_add_keywords_columns_to_ad_creatives
-- Description: 添加keywords_with_volume和negative_keywords列到ad_creatives表
-- Created: 2025-12-03
-- Reason: 代码需要存储带搜索量的关键词和否定关键词

-- 添加keywords_with_volume列（存储带搜索量信息的关键词JSON）
ALTER TABLE ad_creatives ADD COLUMN keywords_with_volume TEXT DEFAULT NULL;

-- 添加negative_keywords列（存储否定关键词JSON数组）
ALTER TABLE ad_creatives ADD COLUMN negative_keywords TEXT DEFAULT NULL;

-- 添加explanation列（创意生成说明）
ALTER TABLE ad_creatives ADD COLUMN explanation TEXT DEFAULT NULL;

-- 验证列已添加
SELECT name, type, dflt_value
FROM pragma_table_info('ad_creatives')
WHERE name IN ('keywords_with_volume', 'negative_keywords', 'explanation');
