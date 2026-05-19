-- Migration: 243_enforce_campaign_offer_one_to_one
-- Description: Enforce strict one active campaign per offer (Offer ↔ Campaign 1:1)
-- PostgreSQL

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY offer_id
      ORDER BY
        CASE WHEN creation_status IN ('published', 'synced') THEN 0 ELSE 1 END,
        CASE
          WHEN google_campaign_id IS NOT NULL AND BTRIM(google_campaign_id) <> '' THEN 0
          ELSE 1
        END,
        updated_at DESC NULLS LAST,
        id DESC
    ) AS rn
  FROM campaigns
  WHERE is_deleted = FALSE
)
UPDATE campaigns AS c
SET
  is_deleted = TRUE,
  updated_at = NOW()
FROM ranked AS r
WHERE c.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_offer_id_active_unique
ON campaigns(offer_id)
WHERE is_deleted = FALSE;
