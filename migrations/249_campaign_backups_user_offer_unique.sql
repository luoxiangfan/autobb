-- Migration: 249_campaign_backups_user_offer_unique
-- Description: Dedupe campaign_backups to one row per (user_id, offer_id), then enforce unique (any backup_source)
-- SQLite

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, offer_id
      ORDER BY
        backup_version DESC,
        CASE
          WHEN campaign_config IS NOT NULL
            AND TRIM(campaign_config) NOT IN ('', '{}', 'null')
          THEN 0
          ELSE 1
        END,
        updated_at DESC,
        id DESC
    ) AS rn
  FROM campaign_backups
)
DELETE FROM campaign_backups
WHERE id NOT IN (SELECT id FROM ranked WHERE rn = 1);

UPDATE campaign_backups
SET backup_source = 'autoads', updated_at = datetime('now')
WHERE backup_source = 'publish';

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_backups_user_offer_unique
ON campaign_backups(user_id, offer_id);
