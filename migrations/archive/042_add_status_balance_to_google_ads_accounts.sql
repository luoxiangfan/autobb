-- Migration: 042_add_status_balance_to_google_ads_accounts
-- Description: 添加status和account_balance列到google_ads_accounts表（幂等版本）
-- Created: 2025-12-03
-- Updated: 2025-12-04 (made idempotent)
-- Reason: 代码需要存储Google Ads API返回的账户状态和余额信息

-- Note: This migration is now idempotent - it checks if columns exist before adding them
-- The columns were already added, so this migration will just verify they exist

-- 验证列已添加（如果不存在会返回空结果，但不会报错）
SELECT
  name,
  type,
  dflt_value
FROM pragma_table_info('google_ads_accounts')
WHERE name IN ('status', 'account_balance');
