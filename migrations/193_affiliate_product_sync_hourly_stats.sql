-- Migration: 193_affiliate_product_sync_hourly_stats.sql
-- Date: 2026-02-27
-- Description: 新增 YP 同步小时级抓取快照表（SQLite）

CREATE TABLE IF NOT EXISTS affiliate_product_sync_hourly_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  run_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  hour_bucket TEXT NOT NULL,
  max_total_items INTEGER NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES affiliate_product_sync_runs(id) ON DELETE CASCADE,
  UNIQUE(run_id, hour_bucket)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_product_sync_hourly_stats_user_platform_hour
  ON affiliate_product_sync_hourly_stats(user_id, platform, hour_bucket DESC);

CREATE INDEX IF NOT EXISTS idx_affiliate_product_sync_hourly_stats_run_hour
  ON affiliate_product_sync_hourly_stats(run_id, hour_bucket DESC);
