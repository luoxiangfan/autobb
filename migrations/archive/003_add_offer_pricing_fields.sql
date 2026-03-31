-- Migration: 003_add_offer_pricing_fields
-- Description: Add product_price and commission_payout fields to offers table
-- Date: 2025-11-18

-- Add product_price field (stored as decimal string, e.g., "699.00")
ALTER TABLE offers ADD COLUMN product_price TEXT;

-- Add commission_payout field (stored as percentage string, e.g., "6.75")
ALTER TABLE offers ADD COLUMN commission_payout TEXT;

-- Add currency field to store the original currency (default USD)
ALTER TABLE offers ADD COLUMN product_currency TEXT DEFAULT 'USD';

-- Add comments for clarity
-- product_price: Product price in the specified currency (e.g., "699.00")
-- commission_payout: Commission percentage (e.g., "6.75" for 6.75%)
-- product_currency: Currency code (e.g., "USD", "EUR", "GBP")
