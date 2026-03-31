-- Migration: 添加AI增强数据字段（PostgreSQL版本）
-- 目的: 存储AI返回的完整数据（pricing, reviews, competitiveEdges, keywords）
-- 日期: 2025-12-07
-- P0优化: 提升广告创意质量20-30%

-- 添加AI产品评论洞察字段（JSONB格式，PostgreSQL原生JSON支持）
-- 存储: rating, count, sentiment, positives, concerns, useCases
ALTER TABLE offers ADD COLUMN ai_reviews JSONB;

-- 添加AI竞争优势字段（JSONB格式）
-- 存储: badges, primeEligible, stockStatus, salesRank
ALTER TABLE offers ADD COLUMN ai_competitive_edges JSONB;

-- 添加AI关键词列表字段（JSONB格式）
-- 存储: AI生成的产品关键词数组
ALTER TABLE offers ADD COLUMN ai_keywords JSONB;

-- 创建索引以优化JSON查询性能
CREATE INDEX IF NOT EXISTS idx_offers_ai_reviews_rating ON offers ((ai_reviews->>'rating'));
CREATE INDEX IF NOT EXISTS idx_offers_ai_reviews_sentiment ON offers ((ai_reviews->>'sentiment'));
CREATE INDEX IF NOT EXISTS idx_offers_ai_competitive_edges_badges ON offers USING GIN (ai_competitive_edges);
CREATE INDEX IF NOT EXISTS idx_offers_ai_keywords ON offers USING GIN (ai_keywords);

-- 说明:
-- 1. ai_reviews: 存储 ProductInfo.reviews 对象
-- 2. ai_competitive_edges: 存储 ProductInfo.competitiveEdges 对象
-- 3. ai_keywords: 存储 ProductInfo.keywords 数组
-- 4. pricing 和 promotions 字段已存在，将复用存储 ProductInfo.pricing 和 ProductInfo.promotions
-- 5. PostgreSQL使用JSONB格式以获得更好的查询性能和索引支持
