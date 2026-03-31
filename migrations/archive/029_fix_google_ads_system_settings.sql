-- Migration: Fix google_ads system_settings configuration
-- Created: 2024-12-02
-- Description: 添加 login_customer_id 配置项，并更新其他字段的约束和描述

-- PostgreSQL version
-- =====================================================

-- 1. 添加 login_customer_id 配置项（如果不存在）
INSERT INTO system_settings (
  user_id, category, config_key, data_type,
  is_sensitive, is_required, default_value, description
)
SELECT
  NULL, 'google_ads', 'login_customer_id', 'string',
  FALSE, TRUE, NULL, 'Google Ads Login Customer ID (MCC账户ID)'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE category = 'google_ads'
    AND config_key = 'login_customer_id'
    AND user_id IS NULL
);

-- 2. 更新 client_id: 改为选填
UPDATE system_settings
SET
  is_required = FALSE,
  description = 'OAuth 2.0 Client ID（选填，可使用平台共享配置）'
WHERE category = 'google_ads'
  AND config_key = 'client_id'
  AND user_id IS NULL;

-- 3. 更新 client_secret: 改为选填
UPDATE system_settings
SET
  is_required = FALSE,
  description = 'OAuth 2.0 Client Secret（选填，可使用平台共享配置）'
WHERE category = 'google_ads'
  AND config_key = 'client_secret'
  AND user_id IS NULL;

-- 4. 更新 developer_token: 改为选填
UPDATE system_settings
SET
  is_required = FALSE,
  description = 'Google Ads Developer Token（选填，可使用平台共享配置）'
WHERE category = 'google_ads'
  AND config_key = 'developer_token'
  AND user_id IS NULL;


-- SQLite version
-- =====================================================
-- Note: SQLite uses different syntax for INSERT OR IGNORE

-- 1. 添加 login_customer_id 配置项（如果不存在）
-- INSERT OR IGNORE INTO system_settings (
--   user_id, category, config_key, data_type,
--   is_sensitive, is_required, default_value, description
-- ) VALUES (
--   NULL, 'google_ads', 'login_customer_id', 'string',
--   0, 1, NULL, 'Google Ads Login Customer ID (MCC账户ID)'
-- );

-- 2. 更新 client_id: 改为选填
-- UPDATE system_settings
-- SET
--   is_required = 0,
--   description = 'OAuth 2.0 Client ID（选填，可使用平台共享配置）'
-- WHERE category = 'google_ads'
--   AND config_key = 'client_id'
--   AND user_id IS NULL;

-- 3. 更新 client_secret: 改为选填
-- UPDATE system_settings
-- SET
--   is_required = 0,
--   description = 'OAuth 2.0 Client Secret（选填，可使用平台共享配置）'
-- WHERE category = 'google_ads'
--   AND config_key = 'client_secret'
--   AND user_id IS NULL;

-- 4. 更新 developer_token: 改为选填
-- UPDATE system_settings
-- SET
--   is_required = 0,
--   description = 'Google Ads Developer Token（选填，可使用平台共享配置）'
-- WHERE category = 'google_ads'
--   AND config_key = 'developer_token'
--   AND user_id IS NULL;
