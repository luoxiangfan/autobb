-- Migration: 182_affiliate_product_sync_run_checkpoint.sql
-- Date: 2026-02-18
-- Description: affiliate_product_sync_runs 增加断点续跑与心跳字段（SQLite）

ALTER TABLE affiliate_product_sync_runs
  ADD COLUMN cursor_page INTEGER NOT NULL DEFAULT 0;

ALTER TABLE affiliate_product_sync_runs
  ADD COLUMN processed_batches INTEGER NOT NULL DEFAULT 0;

ALTER TABLE affiliate_product_sync_runs
  ADD COLUMN last_heartbeat_at TEXT;

CREATE INDEX IF NOT EXISTS idx_affiliate_product_sync_runs_status_updated
  ON affiliate_product_sync_runs(status, updated_at DESC);

