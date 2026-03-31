-- Migration: 20260306_offline_not_soft_delete.pg.sql
-- Date: 2026-03-06
-- Description: 确保历史下线(offline)的广告系列仅标记 REMOVED，而不被软删除（PostgreSQL）

UPDATE campaigns
SET is_deleted = FALSE,
    deleted_at = NULL
WHERE status = 'REMOVED'
  AND is_deleted = TRUE
  AND (removed_reason = 'offline' OR removed_reason IS NULL);
