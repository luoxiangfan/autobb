-- Migration: Add enhanced extraction fields to offers table
-- Purpose: Store AI-enhanced analysis results (P0/P1/P2/P3 optimization features)
-- Date: 2025-12-01

-- P0优化: 增强的关键词和产品信息
ALTER TABLE offers ADD COLUMN enhanced_keywords TEXT;        -- JSON: 增强的关键词列表 [{keyword, volume, competition, score}]
ALTER TABLE offers ADD COLUMN enhanced_product_info TEXT;    -- JSON: 增强的产品信息 {features, benefits, useCases}
ALTER TABLE offers ADD COLUMN enhanced_review_analysis TEXT; -- JSON: 增强的评论分析 {sentiment, themes, insights}
ALTER TABLE offers ADD COLUMN extraction_quality_score INTEGER; -- 提取质量评分 0-100
ALTER TABLE offers ADD COLUMN extraction_enhanced_at TEXT;   -- ISO timestamp: 增强提取完成时间

-- P1优化: 增强的标题和描述
ALTER TABLE offers ADD COLUMN enhanced_headlines TEXT;       -- JSON: 增强的广告标题列表
ALTER TABLE offers ADD COLUMN enhanced_descriptions TEXT;    -- JSON: 增强的广告描述列表

-- P2优化: 竞品分析和本地化
ALTER TABLE offers ADD COLUMN localization_adapt TEXT;       -- JSON: 本地化适配结果 {currency, culturalNotes, localKeywords}

-- P3优化: 品牌识别
ALTER TABLE offers ADD COLUMN brand_analysis TEXT;           -- JSON: 品牌分析结果 {positioning, voice, competitors}

-- 创建索引以优化查询性能
CREATE INDEX IF NOT EXISTS idx_offers_extraction_quality ON offers(extraction_quality_score);
CREATE INDEX IF NOT EXISTS idx_offers_enhanced_at ON offers(extraction_enhanced_at);

-- Notes:
-- 1. enhanced_keywords: [{keyword: string, volume: number, competition: string, score: number}]
-- 2. enhanced_product_info: {features: string[], benefits: string[], useCases: string[]}
-- 3. enhanced_review_analysis: {sentiment: string, themes: string[], insights: string[]}
-- 4. extraction_quality_score: 0-100, calculated based on data completeness
-- 5. enhanced_headlines: string[] (optimized for CTR)
-- 6. enhanced_descriptions: string[] (optimized for conversions)
-- 7. localization_adapt: {currency: string, culturalNotes: string[], localKeywords: string[]}
-- 8. brand_analysis: {positioning: string, voice: string, competitors: string[]}
