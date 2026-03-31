-- Migration: 003_add_offer_pricing_fields
-- Description: Add product_price and commission_payout fields to offers table
-- Date: 2025-11-18

-- Add product_price field (stored as decimal string, e.g., "699.00")

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'product_price') THEN
    ALTER TABLE offers ADD COLUMN product_price TEXT;
    RAISE NOTICE '✅ 添加 product_price 字段到 offers';
  ELSE
    RAISE NOTICE '⏭️  product_price 字段已存在于 offers';
  END IF;
END $$;

-- Add commission_payout field (stored as percentage string, e.g., "6.75")

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'commission_payout') THEN
    ALTER TABLE offers ADD COLUMN commission_payout TEXT;
    RAISE NOTICE '✅ 添加 commission_payout 字段到 offers';
  ELSE
    RAISE NOTICE '⏭️  commission_payout 字段已存在于 offers';
  END IF;
END $$;

-- Add currency field to store the original currency (default USD)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'product_currency') THEN
    ALTER TABLE offers ADD COLUMN product_currency TEXT DEFAULT 'USD';
    RAISE NOTICE '✅ 添加 product_currency 字段到 offers';
  ELSE
    RAISE NOTICE '⏭️  product_currency 字段已存在于 offers';
  END IF;
END $$;

-- Add comments for clarity
-- product_price: Product price in the specified currency (e.g., "699.00")
-- commission_payout: Commission percentage (e.g., "6.75" for 6.75%)
-- product_currency: Currency code (e.g., "USD", "EUR", "GBP")


-- 记录迁移历史
INSERT INTO migration_history (migration_name)
VALUES ('003_add_offer_pricing_fields.pg')
ON CONFLICT (migration_name) DO NOTHING;
