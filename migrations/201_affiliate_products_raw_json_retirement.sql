-- Migration: 201_affiliate_products_raw_json_retirement.sql
-- Date: 2026-03-05
-- Description: affiliate_products 结构化字段补齐并为 raw_json 退役提供 24h 自动删列控制

ALTER TABLE affiliate_products
  ADD COLUMN commission_rate_mode TEXT;

ALTER TABLE affiliate_products
  ADD COLUMN is_deeplink INTEGER;

ALTER TABLE affiliate_products
  ADD COLUMN is_confirmed_invalid INTEGER NOT NULL DEFAULT 0;

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
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  drop_after_at TEXT NOT NULL,
  cleanup_completed_at TEXT,
  raw_json_drop_started_at TEXT,
  raw_json_drop_completed_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO affiliate_product_raw_json_retirement (
  singleton_id,
  drop_after_at
)
VALUES (
  1,
  datetime('now', '+1 day')
);
