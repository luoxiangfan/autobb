-- Migration: 236_google_ads_org_shared_and_credential_source.pg.sql
-- Description: Google Ads 组织级 OAuth 应用模板 + 用户 credential_source 模板行

INSERT INTO system_settings (
  category,
  key,
  user_id,
  value,
  default_value,
  description,
  is_sensitive,
  is_required,
  data_type
)
SELECT
  'google_ads',
  'credential_source',
  NULL,
  NULL,
  'dedicated_user',
  'Google Ads 应用凭证来源：dedicated_user=用户自备；inherit_org=使用管理员组织级配置',
  false,
  false,
  'string'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE category = 'google_ads' AND key = 'credential_source' AND user_id IS NULL
);

INSERT INTO system_settings (
  category,
  key,
  user_id,
  value,
  default_value,
  description,
  is_sensitive,
  is_required,
  data_type
)
SELECT
  'google_ads_shared',
  'client_id',
  NULL,
  NULL,
  NULL,
  '组织级 Google Ads OAuth Client ID（供 inherit_org 用户使用）',
  true,
  true,
  'string'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE category = 'google_ads_shared' AND key = 'client_id' AND user_id IS NULL
);

INSERT INTO system_settings (
  category,
  key,
  user_id,
  value,
  default_value,
  description,
  is_sensitive,
  is_required,
  data_type
)
SELECT
  'google_ads_shared',
  'client_secret',
  NULL,
  NULL,
  NULL,
  '组织级 Google Ads OAuth Client Secret',
  true,
  true,
  'string'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE category = 'google_ads_shared' AND key = 'client_secret' AND user_id IS NULL
);

INSERT INTO system_settings (
  category,
  key,
  user_id,
  value,
  default_value,
  description,
  is_sensitive,
  is_required,
  data_type
)
SELECT
  'google_ads_shared',
  'developer_token',
  NULL,
  NULL,
  NULL,
  '组织级 Google Ads Developer Token',
  true,
  true,
  'string'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE category = 'google_ads_shared' AND key = 'developer_token' AND user_id IS NULL
);
