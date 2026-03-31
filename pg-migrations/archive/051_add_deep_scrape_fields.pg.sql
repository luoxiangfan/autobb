-- Migration: 051_add_deep_scrape_fields
-- Description: 为scraped_products表添加深度抓取数据字段（PostgreSQL版本）
-- Created: 2025-12-04
-- Purpose: 支持店铺热销商品深度抓取，存储详情页数据、评论分析、竞品分析

-- 添加深度抓取相关字段
ALTER TABLE scraped_products ADD COLUMN deep_scrape_data TEXT;
ALTER TABLE scraped_products ADD COLUMN review_analysis TEXT;
ALTER TABLE scraped_products ADD COLUMN competitor_analysis TEXT;
ALTER TABLE scraped_products ADD COLUMN has_deep_data BOOLEAN DEFAULT FALSE;

-- 添加索引以优化查询
CREATE INDEX IF NOT EXISTS idx_scraped_products_has_deep_data
  ON scraped_products(offer_id, user_id, has_deep_data);
