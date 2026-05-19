-- Migration: 244_soft_delete_legacy_failed_campaigns
-- Description: Soft-delete legacy failed campaigns still holding offer_id unique slots (pre PUBLISH_FAILED is_deleted fix)
-- PostgreSQL

UPDATE campaigns
SET
  is_deleted = TRUE,
  deleted_at = NOW(),
  updated_at = NOW()
WHERE is_deleted = FALSE
  AND creation_status = 'failed';
