-- ==========================================
-- Migration: 044_fix_offer_name_unique_constraint
-- Purpose: 修复 offer_name 全局唯一约束为用户级别唯一
-- Issue: offer_name 当前是全局唯一，会导致不同用户创建同名 Offer 冲突
-- Solution: 改为 UNIQUE(user_id, offer_name) 组合唯一约束
-- ==========================================

-- SQLite 不支持直接修改约束，需要重建表

-- Step 1: 创建临时表（包含正确的约束）
CREATE TABLE IF NOT EXISTS offers_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  brand TEXT NOT NULL,
  product_name TEXT,
  category TEXT,
  target_country TEXT NOT NULL,
  target_language TEXT,
  offer_name TEXT,  -- 移除全局 UNIQUE 约束
  affiliate_link TEXT,
  brand_description TEXT,
  unique_selling_points TEXT,
  product_highlights TEXT,
  target_audience TEXT,
  final_url TEXT,
  final_url_suffix TEXT,
  product_price TEXT,
  commission_payout TEXT,
  scrape_status TEXT NOT NULL DEFAULT 'pending',
  scrape_error TEXT,
  scraped_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  industry_code TEXT,
  review_analysis TEXT,
  competitor_analysis TEXT,
  visual_analysis TEXT,
  extracted_keywords TEXT,
  extracted_headlines TEXT,
  extracted_descriptions TEXT,
  extraction_metadata TEXT,
  extracted_at TEXT,
  enhanced_keywords TEXT,
  enhanced_product_info TEXT,
  enhanced_review_analysis TEXT,
  extraction_quality_score INTEGER,
  extraction_enhanced_at TEXT,
  enhanced_headlines TEXT,
  enhanced_descriptions TEXT,
  localization_adapt TEXT,
  brand_analysis TEXT,
  pricing TEXT,
  promotions TEXT,
  scraped_data TEXT,
  product_currency TEXT DEFAULT 'USD',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  reviews TEXT,
  competitive_edges TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, offer_name)  -- 用户级别唯一约束
);

-- Step 2: 复制数据
INSERT INTO offers_new SELECT
  id, user_id, url, brand, product_name, category, target_country, target_language,
  offer_name, affiliate_link, brand_description, unique_selling_points, product_highlights,
  target_audience, final_url, final_url_suffix, product_price, commission_payout,
  scrape_status, scrape_error, scraped_at, is_active, industry_code, review_analysis,
  competitor_analysis, visual_analysis, extracted_keywords, extracted_headlines,
  extracted_descriptions, extraction_metadata, extracted_at, enhanced_keywords,
  enhanced_product_info, enhanced_review_analysis, extraction_quality_score,
  extraction_enhanced_at, enhanced_headlines, enhanced_descriptions, localization_adapt,
  brand_analysis, pricing, promotions, scraped_data, product_currency, is_deleted,
  deleted_at, reviews, competitive_edges, created_at, updated_at
FROM offers;

-- Step 3: 删除旧表
DROP TABLE offers;

-- Step 4: 重命名新表
ALTER TABLE offers_new RENAME TO offers;

-- Step 5: 重建索引
CREATE INDEX IF NOT EXISTS idx_offers_user_id ON offers(user_id);
CREATE INDEX IF NOT EXISTS idx_offers_offer_name ON offers(offer_name);
CREATE INDEX IF NOT EXISTS idx_offers_is_deleted ON offers(is_deleted);
CREATE INDEX IF NOT EXISTS idx_offers_deleted_at ON offers(deleted_at);

-- 验证约束
-- SELECT sql FROM sqlite_master WHERE type='table' AND name='offers';
