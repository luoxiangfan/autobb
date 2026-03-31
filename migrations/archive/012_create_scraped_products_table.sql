-- Migration: 创建scraped_products表存储产品抓取数据
-- Date: 2025-11-20
-- Description: Phase 3数据持久化 - 存储Amazon店铺页产品数据（含促销、徽章、Prime标识）

-- 删除旧表（如果存在）
DROP TABLE IF EXISTS scraped_products;

-- 创建scraped_products表
CREATE TABLE scraped_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);

-- 创建索引优化查询性能
CREATE INDEX IF NOT EXISTS idx_scraped_products_offer_id
ON scraped_products(offer_id);

CREATE INDEX IF NOT EXISTS idx_scraped_products_rank
ON scraped_products(offer_id, rank);

CREATE INDEX IF NOT EXISTS idx_scraped_products_hot_score
ON scraped_products(offer_id, hot_score DESC);

CREATE INDEX IF NOT EXISTS idx_scraped_products_is_hot
ON scraped_products(offer_id, is_hot, rank);

CREATE INDEX IF NOT EXISTS idx_scraped_products_phase3
ON scraped_products(offer_id, promotion, badge, is_prime);

-- 创建视图：Top热销商品
CREATE VIEW IF NOT EXISTS v_top_hot_products AS
SELECT
  sp.*,
  o.brand,
  o.target_country,
  o.category
FROM scraped_products sp
JOIN offers o ON sp.offer_id = o.id
WHERE sp.is_hot = 1
ORDER BY sp.offer_id, sp.rank;

-- 创建视图：Phase 3增强数据统计
CREATE VIEW IF NOT EXISTS v_phase3_statistics AS
SELECT
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
GROUP BY sp.offer_id, o.brand;
