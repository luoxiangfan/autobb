-- Emergency Fix: Restore all missing global templates (PostgreSQL)
-- Purpose: Re-insert all global templates that were deleted by 084 migration
-- Date: 2025-12-20
-- This is a CRITICAL fix for production

-- Google Ads settings
INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, description
)
SELECT NULL, 'google_ads', 'login_customer_id', NULL, 'string', false, true, 'MCC管理账户ID，用于访问您管理的广告账户'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'google_ads' AND key = 'login_customer_id' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, description
)
SELECT NULL, 'google_ads', 'client_id', NULL, 'string', true, false, 'OAuth 2.0客户端ID'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'google_ads' AND key = 'client_id' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, description
)
SELECT NULL, 'google_ads', 'client_secret', NULL, 'string', true, false, 'OAuth 2.0客户端密钥'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'google_ads' AND key = 'client_secret' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, description
)
SELECT NULL, 'google_ads', 'developer_token', NULL, 'string', true, false, 'Google Ads API开发者令牌'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'google_ads' AND key = 'developer_token' AND user_id IS NULL);

-- AI settings
INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'ai', 'use_vertex_ai', NULL, 'boolean', false, false, 'false', 'AI模式选择：true=Vertex AI, false=Gemini API'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'ai' AND key = 'use_vertex_ai' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'ai', 'gemini_api_key', NULL, 'string', true, false, NULL, 'Gemini API密钥'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'ai' AND key = 'gemini_api_key' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'ai', 'gemini_model', NULL, 'string', false, false, 'gemini-2.5-pro', 'Gemini模型名称'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'ai' AND key = 'gemini_model' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'ai', 'gcp_project_id', NULL, 'string', false, false, NULL, 'GCP项目ID'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'ai' AND key = 'gcp_project_id' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'ai', 'gcp_location', NULL, 'string', false, false, 'us-central1', 'GCP区域'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'ai' AND key = 'gcp_location' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'ai', 'gcp_service_account_json', NULL, 'text', true, false, NULL, 'GCP Service Account JSON凭证'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'ai' AND key = 'gcp_service_account_json' AND user_id IS NULL);

-- System settings
INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'system', 'currency', NULL, 'string', false, false, 'CNY', '默认货币单位'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'system' AND key = 'currency' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'system', 'language', NULL, 'string', false, false, 'zh-CN', '系统语言'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'system' AND key = 'language' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'system', 'sync_interval_hours', NULL, 'number', false, false, '6', '数据同步间隔（小时）'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'system' AND key = 'sync_interval_hours' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'system', 'link_check_enabled', NULL, 'boolean', false, false, 'true', '是否启用链接检查'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'system' AND key = 'link_check_enabled' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'system', 'link_check_time', NULL, 'string', false, false, '02:00', '链接检查时间'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'system' AND key = 'link_check_time' AND user_id IS NULL);

-- Verification
SELECT 'Global templates restored: ' || COUNT(*) as status
FROM system_settings
WHERE user_id IS NULL;
