-- Migration: Add code-required fields to offers, ad_creatives, google_ads_accounts tables
-- Date: 2025-12-03
-- Description: Add 10 fields used in code but missing from database

-- ============================================================================
-- 1. OFFERS TABLE - Add 3 fields
-- ============================================================================
ALTER TABLE offers ADD COLUMN pricing TEXT;
ALTER TABLE offers ADD COLUMN promotions TEXT;
ALTER TABLE offers ADD COLUMN scraped_data TEXT;

-- ============================================================================
-- 2. AD_CREATIVES TABLE - Add 5 fields
-- ============================================================================
ALTER TABLE ad_creatives ADD COLUMN google_campaign_id TEXT;
ALTER TABLE ad_creatives ADD COLUMN industry_code TEXT;
ALTER TABLE ad_creatives ADD COLUMN orientation TEXT;
ALTER TABLE ad_creatives ADD COLUMN brand TEXT;
ALTER TABLE ad_creatives ADD COLUMN url TEXT;

-- ============================================================================
-- 3. GOOGLE_ADS_ACCOUNTS TABLE - Add 2 fields
-- ============================================================================
ALTER TABLE google_ads_accounts ADD COLUMN parent_mcc_id TEXT;
ALTER TABLE google_ads_accounts ADD COLUMN test_account BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================================
-- Create indexes for new fields
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_ad_creatives_google_campaign_id ON ad_creatives(google_campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_industry_code ON ad_creatives(industry_code);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_orientation ON ad_creatives(orientation);
CREATE INDEX IF NOT EXISTS idx_google_ads_accounts_parent_mcc_id ON google_ads_accounts(parent_mcc_id);
CREATE INDEX IF NOT EXISTS idx_google_ads_accounts_test_account ON google_ads_accounts(test_account);
