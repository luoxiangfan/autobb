-- Migration: 182_affiliate_product_sync_run_checkpoint.pg.sql
-- Date: 2026-02-18
-- Description: affiliate_product_sync_runs 增加断点续跑与心跳字段（PostgreSQL）

ALTER TABLE affiliate_product_sync_runs
  ADD COLUMN IF NOT EXISTS cursor_page INTEGER NOT NULL DEFAULT 0;

ALTER TABLE affiliate_product_sync_runs
  ADD COLUMN IF NOT EXISTS processed_batches INTEGER NOT NULL DEFAULT 0;

ALTER TABLE affiliate_product_sync_runs
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_affiliate_product_sync_runs_status_updated
  ON affiliate_product_sync_runs(status, updated_at DESC);

