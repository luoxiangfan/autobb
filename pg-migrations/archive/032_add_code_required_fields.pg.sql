-- Migration: Add code-required fields to offers, ad_creatives, google_ads_accounts tables (PostgreSQL)
-- Date: 2025-12-03
-- Description: Add 10 fields used in code but missing from database

DO $$
BEGIN
    -- ============================================================================
    -- 1. OFFERS TABLE - Add 3 fields
    -- ============================================================================
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'pricing') THEN
        ALTER TABLE offers ADD COLUMN pricing TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'promotions') THEN
        ALTER TABLE offers ADD COLUMN promotions TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'scraped_data') THEN
        ALTER TABLE offers ADD COLUMN scraped_data TEXT;
    END IF;

    -- ============================================================================
    -- 2. AD_CREATIVES TABLE - Add 5 fields
    -- ============================================================================
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ad_creatives' AND column_name = 'google_campaign_id') THEN
        ALTER TABLE ad_creatives ADD COLUMN google_campaign_id TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ad_creatives' AND column_name = 'industry_code') THEN
        ALTER TABLE ad_creatives ADD COLUMN industry_code TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ad_creatives' AND column_name = 'orientation') THEN
        ALTER TABLE ad_creatives ADD COLUMN orientation TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ad_creatives' AND column_name = 'brand') THEN
        ALTER TABLE ad_creatives ADD COLUMN brand TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ad_creatives' AND column_name = 'url') THEN
        ALTER TABLE ad_creatives ADD COLUMN url TEXT;
    END IF;

    -- ============================================================================
    -- 3. GOOGLE_ADS_ACCOUNTS TABLE - Add 2 fields
    -- ============================================================================
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'google_ads_accounts' AND column_name = 'parent_mcc_id') THEN
        ALTER TABLE google_ads_accounts ADD COLUMN parent_mcc_id TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'google_ads_accounts' AND column_name = 'test_account') THEN
        ALTER TABLE google_ads_accounts ADD COLUMN test_account BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
END $$;

-- ============================================================================
-- Create indexes for new fields
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_ad_creatives_google_campaign_id ON ad_creatives(google_campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_industry_code ON ad_creatives(industry_code);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_orientation ON ad_creatives(orientation);
CREATE INDEX IF NOT EXISTS idx_google_ads_accounts_parent_mcc_id ON google_ads_accounts(parent_mcc_id);
CREATE INDEX IF NOT EXISTS idx_google_ads_accounts_test_account ON google_ads_accounts(test_account);
