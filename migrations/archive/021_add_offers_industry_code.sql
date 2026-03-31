-- Migration: Add industry_code to offers table
-- Date: 2025-11-23
-- Description: 为Offer添加行业分类字段，用于加分系统

-- 添加行业代码字段
ALTER TABLE offers ADD COLUMN industry_code TEXT;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_offers_industry_code ON offers(industry_code);

-- 为现有数据自动分类（可选，稍后通过脚本处理）
-- UPDATE offers SET industry_code = 'ecom_fashion' WHERE industry_code IS NULL;
