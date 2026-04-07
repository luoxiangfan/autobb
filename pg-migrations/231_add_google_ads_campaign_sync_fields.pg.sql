-- Migration 231: Add Google Ads campaign sync fields
-- Created: 2026-04-07
-- Description: Add fields for syncing campaigns from Google Ads and linking to offers

-- Add fields to offers table
ALTER TABLE offers 
  ADD COLUMN IF NOT EXISTS google_ads_campaign_id TEXT,
  ADD COLUMN IF NOT EXISTS sync_source TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS needs_completion BOOLEAN NOT NULL DEFAULT false;

-- Add indexes for offers table
CREATE INDEX IF NOT EXISTS idx_offers_google_ads_campaign_id ON offers(google_ads_campaign_id);
CREATE INDEX IF NOT EXISTS idx_offers_needs_completion ON offers(needs_completion);

-- Add fields to campaigns table
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS synced_from_google_ads BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS needs_offer_completion BOOLEAN NOT NULL DEFAULT false;

-- Add index for campaigns table
CREATE INDEX IF NOT EXISTS idx_campaigns_synced_from_google_ads ON campaigns(synced_from_google_ads);
CREATE INDEX IF NOT EXISTS idx_campaigns_needs_offer_completion ON campaigns(needs_offer_completion);

-- Add comment for documentation
COMMENT ON COLUMN offers.google_ads_campaign_id IS '关联的 Google Ads 广告系列 ID';
COMMENT ON COLUMN offers.sync_source IS '同步来源：google_ads_sync | manual | api';
COMMENT ON COLUMN offers.needs_completion IS '是否需要完善信息';
COMMENT ON COLUMN campaigns.synced_from_google_ads IS '是否从 Google Ads 同步';
COMMENT ON COLUMN campaigns.needs_offer_completion IS '是否需要完善 Offer 信息';
