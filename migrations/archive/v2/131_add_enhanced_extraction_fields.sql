-- Migration: 131_add_enhanced_extraction_fields
-- Description: 为offers表补齐增强提取相关字段（修复生产库schema漂移：offers.enhanced_keywords等列缺失）
-- SQLite版本
-- Date: 2026-01-04

-- 幂等性说明：
-- - SQLite 不支持 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
-- - 本项目迁移脚本 `scripts/migrate.ts` 会在执行前自动跳过“已存在列”的 ADD COLUMN 语句

ALTER TABLE offers ADD COLUMN enhanced_keywords TEXT;            -- JSON字符串：增强关键词列表
ALTER TABLE offers ADD COLUMN enhanced_product_info TEXT;        -- JSON字符串：增强产品信息
ALTER TABLE offers ADD COLUMN extraction_quality_score INTEGER;  -- 0-100 提取质量评分
ALTER TABLE offers ADD COLUMN extraction_enhanced_at TEXT;       -- ISO时间戳：增强提取完成时间
ALTER TABLE offers ADD COLUMN enhanced_headlines TEXT;           -- JSON字符串：增强广告标题列表
ALTER TABLE offers ADD COLUMN enhanced_descriptions TEXT;        -- JSON字符串：增强广告描述列表
ALTER TABLE offers ADD COLUMN localization_adapt TEXT;           -- JSON字符串：本地化适配结果
ALTER TABLE offers ADD COLUMN brand_analysis TEXT;               -- JSON字符串：品牌分析结果

-- 索引（用于筛选与排序）
CREATE INDEX IF NOT EXISTS idx_offers_extraction_quality
ON offers(extraction_quality_score);

CREATE INDEX IF NOT EXISTS idx_offers_extraction_enhanced_at
ON offers(extraction_enhanced_at);

-- 验证字段添加成功
SELECT 'offers增强提取字段添加成功' AS result;
SELECT name, type, "notnull", dflt_value
FROM pragma_table_info('offers')
WHERE name IN (
  'enhanced_keywords',
  'enhanced_product_info',
  'extraction_quality_score',
  'extraction_enhanced_at',
  'enhanced_headlines',
  'enhanced_descriptions',
  'localization_adapt',
  'brand_analysis'
);
