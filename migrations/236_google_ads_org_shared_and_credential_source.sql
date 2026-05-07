-- Migration: 236_google_ads_org_shared_and_credential_source.sql
-- Description: Google Ads 组织级 OAuth 应用模板 + 用户 credential_source 模板行

INSERT OR IGNORE INTO system_settings (
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
VALUES
(
  'google_ads',
  'credential_source',
  NULL,
  NULL,
  'dedicated_user',
  'Google Ads 应用凭证来源：dedicated_user=用户自备；inherit_org=使用管理员组织级配置',
  0,
  0,
  'string'
),
(
  'google_ads_shared',
  'client_id',
  NULL,
  NULL,
  NULL,
  '组织级 Google Ads OAuth Client ID（供 inherit_org 用户使用）',
  1,
  1,
  'string'
),
(
  'google_ads_shared',
  'client_secret',
  NULL,
  NULL,
  NULL,
  '组织级 Google Ads OAuth Client Secret',
  1,
  1,
  'string'
),
(
  'google_ads_shared',
  'developer_token',
  NULL,
  NULL,
  NULL,
  '组织级 Google Ads Developer Token',
  1,
  1,
  'string'
);
