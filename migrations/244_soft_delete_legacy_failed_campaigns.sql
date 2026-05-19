-- Migration: 244_soft_delete_legacy_failed_campaigns
-- Description: Soft-delete legacy failed campaigns still holding offer_id unique slots (pre PUBLISH_FAILED is_deleted fix)
-- SQLite

UPDATE campaigns
SET
  is_deleted = 1,
  deleted_at = datetime('now'),
  updated_at = datetime('now')
WHERE is_deleted = 0
  AND creation_status = 'failed';
