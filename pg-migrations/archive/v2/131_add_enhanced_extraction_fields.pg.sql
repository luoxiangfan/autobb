-- Migration: 131_add_enhanced_extraction_fields
-- Description: 为offers表补齐增强提取相关字段（修复生产库schema漂移：offers.enhanced_keywords等列缺失）
-- PostgreSQL版本
-- Date: 2026-01-04

-- 说明：
-- 1) PostgreSQL 使用 ADD COLUMN IF NOT EXISTS 保持幂等，避免部分环境已存在列时报错
-- 2) 保持与现有offers表一致：时间字段使用TEXT（与created_at/updated_at/scraped_at/extracted_at一致）
-- 3) JSON数据以TEXT存储（与review_analysis/competitor_analysis等一致），由应用层序列化/反序列化

ALTER TABLE offers ADD COLUMN IF NOT EXISTS enhanced_keywords TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS enhanced_product_info TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS extraction_quality_score INTEGER;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS extraction_enhanced_at TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS enhanced_headlines TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS enhanced_descriptions TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS localization_adapt TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS brand_analysis TEXT;

-- 索引（用于筛选与排序）
CREATE INDEX IF NOT EXISTS idx_offers_extraction_quality
ON offers(extraction_quality_score);

CREATE INDEX IF NOT EXISTS idx_offers_extraction_enhanced_at
ON offers(extraction_enhanced_at);

-- 验证字段添加成功
SELECT 'offers增强提取字段添加成功' AS result;

