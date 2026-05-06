-- 允许 google_ads_service_accounts.user_id 为 NULL，表示全租户（管理员）统一配置的服务账号

ALTER TABLE google_ads_service_accounts
  DROP CONSTRAINT IF EXISTS google_ads_service_accounts_user_id_fkey;

ALTER TABLE google_ads_service_accounts
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE google_ads_service_accounts
  ADD CONSTRAINT google_ads_service_accounts_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
