-- Migration: 添加AI增强数据字段
-- 目的: 存储AI返回的完整数据（pricing, reviews, competitiveEdges, keywords）
-- 日期: 2025-12-07
-- P0优化: 提升广告创意质量20-30%

-- 添加AI产品评论洞察字段（JSON格式）
-- 存储: rating, count, sentiment, positives, concerns, useCases
ALTER TABLE offers ADD COLUMN ai_reviews TEXT;

-- 添加AI竞争优势字段（JSON格式）
-- 存储: badges, primeEligible, stockStatus, salesRank
ALTER TABLE offers ADD COLUMN ai_competitive_edges TEXT;

-- 添加AI关键词列表字段（JSON格式）
-- 存储: AI生成的产品关键词数组
ALTER TABLE offers ADD COLUMN ai_keywords TEXT;

-- 说明:
-- 1. ai_reviews: 存储 ProductInfo.reviews 对象
-- 2. ai_competitive_edges: 存储 ProductInfo.competitiveEdges 对象
-- 3. ai_keywords: 存储 ProductInfo.keywords 数组
-- 4. pricing 和 promotions 字段已存在，将复用存储 ProductInfo.pricing 和 ProductInfo.promotions
