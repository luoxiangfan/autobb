-- Migration: 175_campaign_removed_reason_and_state_backfill.sql
-- Date: 2026-02-11
-- Description: 为 campaigns 增加 removed_reason，并回填已移除数据的语义原因

ALTER TABLE campaigns ADD COLUMN removed_reason TEXT;

UPDATE campaigns
SET removed_reason = CASE
  WHEN status = 'REMOVED' AND is_deleted = 1 THEN
    CASE
      WHEN lower(COALESCE(creation_status, '')) = 'draft' THEN 'draft_delete'
      ELSE 'offline'
    END
  WHEN status = 'REMOVED' THEN 'unknown_removed'
  ELSE removed_reason
END
WHERE status = 'REMOVED'
  AND (removed_reason IS NULL OR removed_reason = '');

UPDATE campaigns
SET removed_reason = NULL
WHERE status != 'REMOVED'
  AND removed_reason IS NOT NULL;
