-- Migration: 168_openclaw_affiliate_products.pg.sql
-- Date: 2026-02-07
-- Description: OpenClaw affiliate products catalog

CREATE TABLE IF NOT EXISTS openclaw_affiliate_products (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL,
  external_product_id VARCHAR(100),
  asin VARCHAR(20),
  product_name VARCHAR(500),
  brand_name VARCHAR(200),
  category VARCHAR(200),
  price DECIMAL(10,2),
  currency VARCHAR(10) DEFAULT 'USD',
  commission_rate DECIMAL(5,2),
  discount_percent DECIMAL(5,2),
  rating DECIMAL(3,2),
  review_count INTEGER DEFAULT 0,
  availability VARCHAR(50),
  image_url VARCHAR(1000),
  product_url VARCHAR(2000),
  tracking_url VARCHAR(2000),
  raw_data JSONB,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_oap_user_platform ON openclaw_affiliate_products(user_id, platform);
CREATE INDEX idx_oap_asin ON openclaw_affiliate_products(user_id, asin);
CREATE INDEX idx_oap_synced ON openclaw_affiliate_products(user_id, synced_at DESC);
CREATE UNIQUE INDEX idx_oap_unique ON openclaw_affiliate_products(user_id, platform, COALESCE(asin, external_product_id));
