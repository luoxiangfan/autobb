-- Migration: 193_affiliate_product_sync_hourly_stats.pg.sql
-- Date: 2026-02-27
-- Description: 新增 YP 同步小时级抓取快照表（PostgreSQL）

CREATE TABLE IF NOT EXISTS affiliate_product_sync_hourly_stats (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id INTEGER NOT NULL REFERENCES affiliate_product_sync_runs(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  hour_bucket TIMESTAMPTZ NOT NULL,
  max_total_items INTEGER NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(run_id, hour_bucket)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_product_sync_hourly_stats_user_platform_hour
  ON affiliate_product_sync_hourly_stats(user_id, platform, hour_bucket DESC);

CREATE INDEX IF NOT EXISTS idx_affiliate_product_sync_hourly_stats_run_hour
  ON affiliate_product_sync_hourly_stats(run_id, hour_bucket DESC);
