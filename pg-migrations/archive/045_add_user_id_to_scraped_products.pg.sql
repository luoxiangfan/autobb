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

-- Step 3: 将user_id设置为NOT NULL并添加外键约束
ALTER TABLE scraped_products
ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE scraped_products
ADD CONSTRAINT fk_scraped_products_user_id
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Step 4: 创建用户隔离索引
CREATE INDEX IF NOT EXISTS idx_scraped_products_user_id
ON scraped_products(user_id);

CREATE INDEX IF NOT EXISTS idx_scraped_products_user_offer
ON scraped_products(user_id, offer_id);

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
WHERE sp.is_hot = TRUE
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
  SUM(CASE WHEN sp.is_prime = TRUE THEN 1 ELSE 0 END) as prime_products,
  ROUND(AVG(CASE WHEN sp.rating IS NOT NULL THEN CAST(sp.rating AS REAL) ELSE NULL END), 2) as avg_rating,
  AVG(sp.hot_score) as avg_hot_score
FROM scraped_products sp
JOIN offers o ON sp.offer_id = o.id
WHERE sp.user_id = o.user_id  -- 确保用户隔离
GROUP BY sp.user_id, sp.offer_id, o.brand;

-- 记录迁移历史
INSERT INTO migration_history (migration_name)
VALUES ('045_add_user_id_to_scraped_products.pg')
ON CONFLICT (migration_name) DO NOTHING;
