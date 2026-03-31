-- Migration: 163_affiliate_products_management.sql
-- Date: 2026-02-07
-- Description: 商品管理（联盟商品库、同步任务、商品-Offer关联）

-- ---------------------------------------------------------------------
-- 1) affiliate_products - 联盟商品主表（用户级隔离）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS affiliate_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  mid TEXT NOT NULL,
  asin TEXT,
  brand TEXT,
  product_name TEXT,
  product_url TEXT,
  promo_link TEXT,
  short_promo_link TEXT,
  allowed_countries_json TEXT,
  price_amount REAL,
  price_currency TEXT,
  commission_rate REAL,
  commission_amount REAL,
  raw_json TEXT,
  is_blacklisted BOOLEAN NOT NULL DEFAULT 0,
  last_synced_at TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'platform',
  status TEXT NOT NULL DEFAULT 'queued',
  trigger_source TEXT,
  total_items INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_affiliate_product_sync_runs_user
  ON affiliate_product_sync_runs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_affiliate_product_sync_runs_status
  ON affiliate_product_sync_runs(status, created_at DESC);

-- ---------------------------------------------------------------------
-- 3) affiliate_product_offer_links - 商品创建Offer事实记录（删除Offer后仍保留计数）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS affiliate_product_offer_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,
  created_via TEXT NOT NULL DEFAULT 'single',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES affiliate_products(id) ON DELETE CASCADE,
  UNIQUE(user_id, product_id, offer_id)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_product_offer_links_user
  ON affiliate_product_offer_links(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_affiliate_product_offer_links_product
  ON affiliate_product_offer_links(product_id, created_at DESC);
