-- Migration: 163_affiliate_products_management.pg.sql
-- Date: 2026-02-07
-- Description: 商品管理（联盟商品库、同步任务、商品-Offer关联）

-- ---------------------------------------------------------------------
-- 1) affiliate_products - 联盟商品主表（用户级隔离）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS affiliate_products (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  mid TEXT NOT NULL,
  asin TEXT,
  brand TEXT,
  product_name TEXT,
  product_url TEXT,
  promo_link TEXT,
  short_promo_link TEXT,
  allowed_countries_json TEXT,
  price_amount DOUBLE PRECISION,
  price_currency TEXT,
  commission_rate DOUBLE PRECISION,
  commission_amount DOUBLE PRECISION,
  raw_json TEXT,
  is_blacklisted BOOLEAN NOT NULL DEFAULT FALSE,
  last_synced_at TIMESTAMP,
  last_seen_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, platform, mid)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_platform
  ON affiliate_products(user_id, platform);

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_asin
  ON affiliate_products(user_id, asin);

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_brand
  ON affiliate_products(user_id, brand);

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_updated
  ON affiliate_products(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_blacklist
  ON affiliate_products(user_id, is_blacklisted);

-- ---------------------------------------------------------------------
-- 2) affiliate_product_sync_runs - 商品同步任务审计
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS affiliate_product_sync_runs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'platform',
  status TEXT NOT NULL DEFAULT 'queued',
  trigger_source TEXT,
  total_items INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_affiliate_product_sync_runs_user
  ON affiliate_product_sync_runs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_affiliate_product_sync_runs_status
  ON affiliate_product_sync_runs(status, created_at DESC);

-- ---------------------------------------------------------------------
-- 3) affiliate_product_offer_links - 商品创建Offer事实记录（删除Offer后仍保留计数）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS affiliate_product_offer_links (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES affiliate_products(id) ON DELETE CASCADE,
  offer_id INTEGER NOT NULL,
  created_via TEXT NOT NULL DEFAULT 'single',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, product_id, offer_id)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_product_offer_links_user
  ON affiliate_product_offer_links(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_affiliate_product_offer_links_product
  ON affiliate_product_offer_links(product_id, created_at DESC);
