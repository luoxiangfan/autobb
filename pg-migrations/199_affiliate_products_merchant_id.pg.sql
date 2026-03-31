-- Migration: 199_affiliate_products_merchant_id.pg.sql
-- Date: 2026-03-04
-- Description: affiliate_products 增加 merchant_id（PartnerBoost 商家ID）并补齐 /products 常见筛选索引

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE affiliate_products
  ADD COLUMN IF NOT EXISTS merchant_id TEXT;

UPDATE affiliate_products
SET merchant_id = NULLIF(
  BTRIM(
    COALESCE(
      substring(raw_json from '"brand_id"\s*:\s*"([^"]+)"'),
      substring(raw_json from '"brand_id"\s*:\s*([0-9]+)'),
      substring(raw_json from '"brandId"\s*:\s*"([^"]+)"'),
      substring(raw_json from '"brandId"\s*:\s*([0-9]+)'),
      substring(raw_json from '"bid"\s*:\s*"([^"]+)"'),
      substring(raw_json from '"bid"\s*:\s*([0-9]+)')
    )
  ),
  ''
)
WHERE platform = 'partnerboost'
  AND COALESCE(BTRIM(merchant_id), '') = '';

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

CREATE INDEX IF NOT EXISTS idx_affiliate_products_search_text_trgm
  ON affiliate_products
  USING gin (
    LOWER(
      COALESCE(mid, '')
      || ' '
      || COALESCE(asin, '')
      || ' '
      || COALESCE(product_name, '')
      || ' '
      || COALESCE(brand, '')
    ) gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS idx_affiliate_products_allowed_countries_trgm
  ON affiliate_products
  USING gin (LOWER(allowed_countries_json) gin_trgm_ops)
  WHERE allowed_countries_json IS NOT NULL;
