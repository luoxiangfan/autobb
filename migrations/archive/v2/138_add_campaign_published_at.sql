-- Add published_at to campaigns to track successful publish time (used by Campaigns "投放日期")
ALTER TABLE campaigns ADD COLUMN published_at TEXT;

-- Backfill: for already-published campaigns, use created_at as best-effort publish time
UPDATE campaigns
SET published_at = created_at
WHERE published_at IS NULL
  AND google_campaign_id IS NOT NULL
  AND google_campaign_id != ''
  AND creation_status = 'synced';

