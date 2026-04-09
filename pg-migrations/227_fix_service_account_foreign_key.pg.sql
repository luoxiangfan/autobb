-- 修复 google_ads_accounts 服务账号外键约束 (PostgreSQL)
-- 添加 ON DELETE CASCADE，删除服务账号时自动清理关联账户

-- 先删除原有约束
ALTER TABLE google_ads_accounts 
  DROP CONSTRAINT IF EXISTS google_ads_accounts_service_account_id_fkey;

-- 重新添加带 CASCADE 的约束
ALTER TABLE google_ads_accounts
  ADD CONSTRAINT google_ads_accounts_service_account_id_fkey
  FOREIGN KEY (service_account_id)
  REFERENCES google_ads_service_accounts(id)
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- 添加注释说明
COMMENT ON CONSTRAINT google_ads_accounts_service_account_id_fkey ON google_ads_accounts IS 
  '服务账号外键，删除服务账号时自动删除关联的 Google Ads 账户';
