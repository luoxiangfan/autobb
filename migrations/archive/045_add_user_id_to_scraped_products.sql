-- Migration: 为scraped_products表添加user_id字段实现用户隔离
-- Date: 2025-12-04
-- Description: 修复用户隔离缺失问题，确保scraped_products数据按用户隔离

-- Step 1: 添加user_id字段（允许NULL，用于数据迁移）
ALTER TABLE scraped_products
ADD COLUMN user_id INTEGER;

-- Step 2: 回填user_id数据（从offers表获取）
UPDATE scraped_products
SET user_id = (
  SELECT o.user_id
  FROM offers o
  WHERE o.id = scraped_products.offer_id
);

-- Step 3: 将user_id设置为NOT NULL
-- SQLite不支持直接ALTER COLUMN，需要重建表
CREATE TABLE scraped_products_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,

  -- 基础产品信息
  name TEXT NOT NULL,
  asin TEXT,
  price TEXT,
  rating TEXT,
  review_count TEXT,
  image_url TEXT,

  -- Phase 3: 数据维度增强
  promotion TEXT,              -- 促销信息：折扣、优惠券、限时优惠
  badge TEXT,                  -- 徽章：Amazon's Choice、Best Seller、#1 in Category
  is_prime BOOLEAN DEFAULT 0,  -- Prime会员标识

  -- Phase 2: 热销分析
  hot_score REAL,              -- 热销分数: rating × log10(reviewCount + 1)
  rank INTEGER,                -- 热销排名
  is_hot BOOLEAN DEFAULT 0,    -- 是否为Top 5热销商品
  hot_label TEXT,              -- 热销标签: "🔥 热销商品" or "✅ 畅销商品"

  -- 元数据
  scrape_source TEXT NOT NULL, -- 'amazon_store' or 'independent_store'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- 外键约束
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);

-- 复制数据到新表（处理可能的 NULL 值）
INSERT INTO scraped_products_new (
  id, user_id, offer_id,
  name, asin, price, rating, review_count, image_url,
  promotion, badge, is_prime,
  hot_score, rank, is_hot, hot_label,
  scrape_source,
  created_at,
  updated_at
)
SELECT
  id,
  user_id,
  offer_id,
  name, asin, price, rating, review_count, image_url,
  promotion, badge, is_prime,
  hot_score, rank, is_hot, hot_label,
  scrape_source,
  COALESCE(created_at, datetime('now')),
  COALESCE(updated_at, datetime('now'))
FROM scraped_products;

-- 删除旧表
DROP TABLE scraped_products;

-- 重命名新表
ALTER TABLE scraped_products_new RENAME TO scraped_products;

-- Step 4: 重建索引
CREATE INDEX IF NOT EXISTS idx_scraped_products_user_id
ON scraped_products(user_id);

CREATE INDEX IF NOT EXISTS idx_scraped_products_offer_id
ON scraped_products(offer_id);

CREATE INDEX IF NOT EXISTS idx_scraped_products_user_offer
ON scraped_products(user_id, offer_id);

CREATE INDEX IF NOT EXISTS idx_scraped_products_rank
ON scraped_products(offer_id, rank);

CREATE INDEX IF NOT EXISTS idx_scraped_products_hot_score
ON scraped_products(offer_id, hot_score DESC);

CREATE INDEX IF NOT EXISTS idx_scraped_products_is_hot
ON scraped_products(offer_id, is_hot, rank);

CREATE INDEX IF NOT EXISTS idx_scraped_products_phase3
ON scraped_products(offer_id, promotion, badge, is_prime);

-- Step 5: 重建视图（添加用户隔离）
DROP VIEW IF EXISTS v_top_hot_products;
CREATE VIEW v_top_hot_products AS
SELECT
  sp.*,
  o.brand,
  o.target_country,
  o.category
FROM scraped_products sp
JOIN offers o ON sp.offer_id = o.id
WHERE sp.is_hot = 1
  AND sp.user_id = o.user_id  -- 确保用户隔离
ORDER BY sp.offer_id, sp.rank;

DROP VIEW IF EXISTS v_phase3_statistics;
CREATE VIEW v_phase3_statistics AS
SELECT
  sp.user_id,
  sp.offer_id,
  o.brand,
  COUNT(*) as total_products,
  SUM(CASE WHEN sp.promotion IS NOT NULL THEN 1 ELSE 0 END) as products_with_promotion,
  SUM(CASE WHEN sp.badge IS NOT NULL THEN 1 ELSE 0 END) as products_with_badge,
  SUM(CASE WHEN sp.is_prime = 1 THEN 1 ELSE 0 END) as prime_products,
  ROUND(AVG(CASE WHEN sp.rating IS NOT NULL THEN CAST(sp.rating AS REAL) ELSE NULL END), 2) as avg_rating,
  AVG(sp.hot_score) as avg_hot_score
FROM scraped_products sp
JOIN offers o ON sp.offer_id = o.id
WHERE sp.user_id = o.user_id  -- 确保用户隔离
GROUP BY sp.user_id, sp.offer_id, o.brand;
