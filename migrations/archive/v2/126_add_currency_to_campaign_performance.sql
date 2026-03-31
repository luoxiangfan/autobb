/**
 * Migration 126: Add currency support to campaign_performance table
 *
 * Purpose: Support multi-currency Google Ads accounts
 * - Add currency column to track original currency from Google Ads API
 * - Update historical data with correct currency from google_ads_accounts
 *
 * Background:
 * - Google Ads API returns cost_micros in account's native currency
 * - Different accounts may use USD, CNY, EUR, GBP, etc.
 * - Previously assumed all costs were in USD (incorrect)
 *
 * Date: 2025-12-30
 */

-- Step 1: Add currency column with default 'USD'
ALTER TABLE campaign_performance
ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD';

-- Step 2: Update historical data with correct currency from google_ads_accounts
-- This fixes data where we incorrectly assumed USD
UPDATE campaign_performance
SET currency = (
  SELECT COALESCE(gaa.currency, 'USD')
  FROM campaigns c
  LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
  WHERE c.id = campaign_performance.campaign_id
)
WHERE EXISTS (
  SELECT 1
  FROM campaigns c
  LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
  WHERE c.id = campaign_performance.campaign_id
);

-- Step 3: Create index for efficient currency-based queries
CREATE INDEX IF NOT EXISTS idx_campaign_performance_currency
ON campaign_performance(currency);

-- Step 4: Create compound index for common query patterns
CREATE INDEX IF NOT EXISTS idx_campaign_performance_user_currency_date
ON campaign_performance(user_id, currency, date);

-- Verification query (comment out in production):
-- SELECT
--   currency,
--   COUNT(*) as record_count,
--   SUM(cost) as total_cost,
--   MIN(date) as earliest_date,
--   MAX(date) as latest_date
-- FROM campaign_performance
-- GROUP BY currency
-- ORDER BY total_cost DESC;
