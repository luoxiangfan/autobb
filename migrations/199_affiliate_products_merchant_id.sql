-- Migration: 199_affiliate_products_merchant_id.sql
-- Date: 2026-03-04
-- Description: affiliate_products 增加 merchant_id（PartnerBoost 商家ID）并补齐 /products 常见筛选索引

ALTER TABLE affiliate_products
  ADD COLUMN merchant_id TEXT;

UPDATE affiliate_products
SET merchant_id = NULLIF(
  TRIM(
    COALESCE(
      CASE
        WHEN json_valid(raw_json) THEN json_extract(raw_json, '$.brand_id')
        ELSE NULL
      END,
      CASE
        WHEN json_valid(raw_json) THEN json_extract(raw_json, '$.brandId')
        ELSE NULL
      END,
      CASE
        WHEN json_valid(raw_json) THEN json_extract(raw_json, '$.bid')
        ELSE NULL
      END
    )
  ),
  ''
)
WHERE platform = 'partnerboost'
  AND (merchant_id IS NULL OR TRIM(merchant_id) = '');

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_platform_merchant_id
  ON affiliate_products(user_id, platform, merchant_id);

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_created_at
  ON affiliate_products(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_price_amount
  ON affiliate_products(user_id, price_amount);

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_commission_rate
  ON affiliate_products(user_id, commission_rate);

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_commission_amount
  ON affiliate_products(user_id, commission_amount);

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_platform_merchant_id_id
  ON affiliate_products(user_id, platform, merchant_id, id DESC);
