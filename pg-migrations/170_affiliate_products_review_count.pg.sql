-- Migration: 170_affiliate_products_review_count.pg.sql
-- Date: 2026-02-08
-- Description: affiliate_products 增加商品评论数字段并回填历史数据

ALTER TABLE affiliate_products
  ADD COLUMN IF NOT EXISTS review_count INTEGER;

UPDATE affiliate_products
SET review_count = NULLIF(
  regexp_replace(
    COALESCE(
      raw_json::jsonb->>'review_count',
      raw_json::jsonb->>'reviewCount',
      raw_json::jsonb->>'reviews',
      raw_json::jsonb->>'rating_count',
      raw_json::jsonb->>'ratings_total'
    ),
    '[^0-9]',
    '',
    'g'
  ),
  ''
)::INTEGER
WHERE review_count IS NULL;

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_review_count
  ON affiliate_products(user_id, review_count);
