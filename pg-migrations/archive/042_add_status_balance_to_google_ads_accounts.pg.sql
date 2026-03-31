-- Migration: 042_add_status_balance_to_google_ads_accounts
-- Description: 添加status和account_balance列到google_ads_accounts表
-- Created: 2025-12-03
-- Reason: 代码需要存储Google Ads API返回的账户状态和余额信息

-- 添加status列（账户状态：ENABLED, SUSPENDED, CANCELLED等）

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'google_ads_accounts' AND column_name = 'status') THEN
    ALTER TABLE google_ads_accounts ADD COLUMN status TEXT DEFAULT 'UNKNOWN';
    RAISE NOTICE '✅ 添加 status 字段到 google_ads_accounts';
  ELSE
    RAISE NOTICE '⏭️  status 字段已存在于 google_ads_accounts';
  END IF;
END $$;

-- 添加account_balance列（账户余额，单位为微单位，需要除以1000000）

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'google_ads_accounts' AND column_name = 'account_balance') THEN
    ALTER TABLE google_ads_accounts ADD COLUMN account_balance REAL DEFAULT NULL;
    RAISE NOTICE '✅ 添加 account_balance 字段到 google_ads_accounts';
  ELSE
    RAISE NOTICE '⏭️  account_balance 字段已存在于 google_ads_accounts';
  END IF;
END $$;

-- 验证列已添加 (PostgreSQL版本)
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'google_ads_accounts' AND column_name IN ('status', 'account_balance');


-- 记录迁移历史
INSERT INTO migration_history (migration_name)
VALUES ('042_add_status_balance_to_google_ads_accounts.pg')
ON CONFLICT (migration_name) DO NOTHING;
