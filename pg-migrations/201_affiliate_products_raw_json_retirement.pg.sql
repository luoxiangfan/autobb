-- Migration: 201_affiliate_products_raw_json_retirement.pg.sql
-- Date: 2026-03-05
-- Description: affiliate_products 结构化字段补齐并为 raw_json 退役提供 24h 自动删列控制

ALTER TABLE affiliate_products
  ADD COLUMN IF NOT EXISTS commission_rate_mode TEXT;

ALTER TABLE affiliate_products
  ADD COLUMN IF NOT EXISTS is_deeplink BOOLEAN;

ALTER TABLE affiliate_products
  ADD COLUMN IF NOT EXISTS is_confirmed_invalid BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE affiliate_products
SET commission_rate_mode = CASE
  WHEN commission_amount IS NOT NULL
    AND commission_rate IS NOT NULL
    AND ABS(commission_amount - commission_rate) < 0.000001
    THEN 'amount'
  ELSE 'percent'
END
WHERE commission_rate_mode IS NULL;

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_platform_invalid
  ON affiliate_products(user_id, platform, is_confirmed_invalid);

CREATE TABLE IF NOT EXISTS affiliate_product_raw_json_retirement (
  singleton_id SMALLINT PRIMARY KEY CHECK (singleton_id = 1),
  drop_after_at TIMESTAMPTZ NOT NULL,
  cleanup_completed_at TIMESTAMPTZ,
  raw_json_drop_started_at TIMESTAMPTZ,
  raw_json_drop_completed_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO affiliate_product_raw_json_retirement (
  singleton_id,
  drop_after_at
)
VALUES (
  1,
  CURRENT_TIMESTAMP + INTERVAL '24 hours'
)
ON CONFLICT (singleton_id) DO NOTHING;
