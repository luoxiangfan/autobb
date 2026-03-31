-- Migration: 195_affiliate_product_sync_cursor_scope.sql
-- Date: 2026-02-27
-- Description: affiliate_product_sync_runs 增加 cursor_scope 字段（SQLite）

ALTER TABLE affiliate_product_sync_runs
  ADD COLUMN cursor_scope TEXT;
