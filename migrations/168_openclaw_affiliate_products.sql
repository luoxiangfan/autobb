-- Migration: 168_openclaw_affiliate_products.sql
-- Date: 2026-02-07
-- Description: OpenClaw affiliate products catalog

CREATE TABLE IF NOT EXISTS openclaw_affiliate_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  external_product_id TEXT,
  asin TEXT,
  product_name TEXT,
  brand_name TEXT,
  category TEXT,
  price REAL,
  currency TEXT DEFAULT 'USD',
  commission_rate REAL,
  discount_percent REAL,
  rating REAL,
  review_count INTEGER DEFAULT 0,
  availability TEXT,
  image_url TEXT,
  product_url TEXT,
  tracking_url TEXT,
  raw_data TEXT,
  synced_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_oap_user_platform ON openclaw_affiliate_products(user_id, platform);
CREATE INDEX IF NOT EXISTS idx_oap_asin ON openclaw_affiliate_products(user_id, asin);
CREATE INDEX IF NOT EXISTS idx_oap_synced ON openclaw_affiliate_products(user_id, synced_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_oap_unique ON openclaw_affiliate_products(user_id, platform, COALESCE(asin, external_product_id));
