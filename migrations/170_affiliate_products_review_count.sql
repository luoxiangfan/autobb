-- Migration: 170_affiliate_products_review_count.sql
-- Date: 2026-02-08
-- Description: affiliate_products 增加商品评论数字段并回填历史数据

ALTER TABLE affiliate_products
  ADD COLUMN review_count INTEGER;

UPDATE affiliate_products
SET review_count = CAST(
  NULLIF(
    REPLACE(
      REPLACE(
        REPLACE(
          COALESCE(
            json_extract(raw_json, '$.review_count'),
            json_extract(raw_json, '$.reviewCount'),
            json_extract(raw_json, '$.reviews'),
            json_extract(raw_json, '$.rating_count'),
            json_extract(raw_json, '$.ratings_total')
          ),
          ',',
          ''
        ),
        ' ',
        ''
      ),
      '+',
      ''
    ),
    ''
  ) AS INTEGER
)
WHERE review_count IS NULL;

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_review_count
  ON affiliate_products(user_id, review_count);
