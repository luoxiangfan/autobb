-- Migration: 195_affiliate_product_sync_cursor_scope.pg.sql
-- Date: 2026-02-27
-- Description: affiliate_product_sync_runs 增加 cursor_scope 字段（PostgreSQL）

ALTER TABLE affiliate_product_sync_runs
  ADD COLUMN IF NOT EXISTS cursor_scope TEXT;
