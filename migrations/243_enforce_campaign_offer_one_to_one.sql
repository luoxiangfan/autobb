-- Migration: 243_enforce_campaign_offer_one_to_one
-- Description: Enforce strict one active campaign per offer (Offer ↔ Campaign 1:1)
-- SQLite

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY offer_id
      ORDER BY
        CASE WHEN creation_status IN ('published', 'synced') THEN 0 ELSE 1 END,
        CASE
          WHEN google_campaign_id IS NOT NULL AND TRIM(google_campaign_id) <> '' THEN 0
          ELSE 1
        END,
        updated_at DESC,
        id DESC
    ) AS rn
  FROM campaigns
  WHERE is_deleted = 0
)
UPDATE campaigns
SET
  is_deleted = 1,
  updated_at = datetime('now')
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_offer_id_active_unique
ON campaigns(offer_id)
WHERE is_deleted = 0;
