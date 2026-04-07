-- SQLite Migration 231: Add Google Ads campaign sync fields
-- Created: 2026-04-07
-- Description: Add fields for syncing campaigns from Google Ads and linking to offers

-- SQLite doesn't support adding multiple columns in one ALTER TABLE, so we need to do it one by one

-- Add fields to offers table
-- Note: SQLite requires rewriting the table to add NOT NULL columns with defaults
ALTER TABLE offers ADD COLUMN google_ads_campaign_id TEXT;
ALTER TABLE offers ADD COLUMN sync_source TEXT DEFAULT 'manual';
ALTER TABLE offers ADD COLUMN needs_completion BOOLEAN NOT NULL DEFAULT false;

-- Add fields to campaigns table
ALTER TABLE campaigns ADD COLUMN synced_from_google_ads BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE campaigns ADD COLUMN needs_offer_completion BOOLEAN NOT NULL DEFAULT false;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_offers_google_ads_campaign_id ON offers(google_ads_campaign_id);
CREATE INDEX IF NOT EXISTS idx_offers_needs_completion ON offers(needs_completion);
CREATE INDEX IF NOT EXISTS idx_campaigns_synced_from_google_ads ON campaigns(synced_from_google_ads);
CREATE INDEX IF NOT EXISTS idx_campaigns_needs_offer_completion ON campaigns(needs_offer_completion);
