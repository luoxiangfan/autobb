-- Migration: 026_normalize_prompt_categories (PostgreSQL version)
-- Description: 统一规范 Prompt 分类命名（全部使用中文）
-- Created: 2025-12-01

-- 分类标准化映射：
-- Ad Creative → 广告创意生成
-- 信息提取 → 产品分析/品牌分析（根据具体功能）
-- 关键词 → 关键词生成
-- 创意评分 → 广告创意生成（因为是创意质量评分）
-- 广告创意 → 广告创意生成

-- 1. 修正 ad_elements_headlines 和 ad_elements_descriptions (广告创意 → 广告创意生成)
UPDATE prompt_versions
SET category = '广告创意生成'
WHERE category = '广告创意';

-- 2. 修正 keywords_generation (关键词 → 关键词生成)
UPDATE prompt_versions
SET category = '关键词生成'
WHERE category = '关键词';

-- 3. 修正 creative_quality_scoring (创意评分 → 广告创意生成)
UPDATE prompt_versions
SET category = '广告创意生成'
WHERE category = '创意评分';

-- 4. 修正信息提取分类（根据功能拆分）
-- product_analysis_single → 产品分析
UPDATE prompt_versions
SET category = '产品分析'
WHERE prompt_id = 'product_analysis_single' AND category = '信息提取';

-- brand_analysis_store → 品牌分析
UPDATE prompt_versions
SET category = '品牌分析'
WHERE prompt_id = 'brand_analysis_store' AND category = '信息提取';

-- brand_name_extraction → 品牌识别
UPDATE prompt_versions
SET category = '品牌识别'
WHERE prompt_id = 'brand_name_extraction' AND category = '信息提取';

-- 记录迁移历史
INSERT INTO migration_history (migration_name)
VALUES ('026_normalize_prompt_categories.pg')
ON CONFLICT (migration_name) DO NOTHING;
