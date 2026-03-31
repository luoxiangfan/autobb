-- 支持 Standard Access（无限次/天）
-- 扩展 api_access_level 的 CHECK 约束

ALTER TABLE google_ads_credentials
DROP CONSTRAINT IF EXISTS google_ads_credentials_api_access_level_check;

ALTER TABLE google_ads_credentials
ADD CONSTRAINT google_ads_credentials_api_access_level_check
CHECK (api_access_level IN ('test', 'explorer', 'basic', 'standard'));

ALTER TABLE google_ads_service_accounts
DROP CONSTRAINT IF EXISTS google_ads_service_accounts_api_access_level_check;

ALTER TABLE google_ads_service_accounts
ADD CONSTRAINT google_ads_service_accounts_api_access_level_check
CHECK (api_access_level IN ('test', 'explorer', 'basic', 'standard'));
