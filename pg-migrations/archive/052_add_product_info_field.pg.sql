-- Migration: 052_add_product_info_field
-- Description: 为scraped_products表添加product_info字段存储AI产品分析结果（PostgreSQL版本）
-- Created: 2025-12-04
-- Purpose: 支持店铺热销商品的AI产品分析（brandDescription, uniqueSellingPoints等）

-- 添加AI产品分析字段
ALTER TABLE scraped_products ADD COLUMN product_info TEXT;

-- 添加索引以优化包含深度数据的商品查询
CREATE INDEX IF NOT EXISTS idx_scraped_products_deep_complete
  ON scraped_products(offer_id, user_id, has_deep_data, asin);
