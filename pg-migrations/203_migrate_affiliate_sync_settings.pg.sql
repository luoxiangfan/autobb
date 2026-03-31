-- Migration: 203_migrate_affiliate_sync_settings.pg.sql
-- Date: 2026-03-06
-- Description: 将联盟凭证与佣金同步配置从 openclaw 分类迁移到 affiliate_sync 分类，并移除旧开关键

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
  'affiliate_sync',
  'yeahpromos_token',
  NULL,
  NULL,
  NULL,
  'YeahPromos API Token',
  true,
  false,
  'string'
WHERE NOT EXISTS (
  SELECT 1
  FROM system_settings
  WHERE category = 'affiliate_sync' AND key = 'yeahpromos_token' AND user_id IS NULL
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
  'affiliate_sync',
  'yeahpromos_site_id',
  NULL,
  NULL,
  NULL,
  'YeahPromos Site ID',
  false,
  false,
  'string'
WHERE NOT EXISTS (
  SELECT 1
  FROM system_settings
  WHERE category = 'affiliate_sync' AND key = 'yeahpromos_site_id' AND user_id IS NULL
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
  'affiliate_sync',
  'partnerboost_token',
  NULL,
  NULL,
  NULL,
  'PartnerBoost API Token',
  true,
  false,
  'string'
WHERE NOT EXISTS (
  SELECT 1
  FROM system_settings
  WHERE category = 'affiliate_sync' AND key = 'partnerboost_token' AND user_id IS NULL
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
  'affiliate_sync',
  'partnerboost_base_url',
  NULL,
  NULL,
  'https://app.partnerboost.com',
  'PartnerBoost API Base URL',
  false,
  false,
  'string'
WHERE NOT EXISTS (
  SELECT 1
  FROM system_settings
  WHERE category = 'affiliate_sync' AND key = 'partnerboost_base_url' AND user_id IS NULL
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
  'affiliate_sync',
  'openclaw_affiliate_sync_interval_hours',
  NULL,
  NULL,
  '1',
  '联盟佣金自动同步间隔（小时，建议 1-24）',
  false,
  false,
  'number'
WHERE NOT EXISTS (
  SELECT 1
  FROM system_settings
  WHERE category = 'affiliate_sync' AND key = 'openclaw_affiliate_sync_interval_hours' AND user_id IS NULL
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
  'affiliate_sync',
  'openclaw_affiliate_sync_mode',
  NULL,
  NULL,
  'incremental',
  '联盟佣金同步模式（incremental/realtime）',
  false,
  false,
  'string'
WHERE NOT EXISTS (
  SELECT 1
  FROM system_settings
  WHERE category = 'affiliate_sync' AND key = 'openclaw_affiliate_sync_mode' AND user_id IS NULL
);

UPDATE system_settings AS target
SET
  value = source.value,
  encrypted_value = source.encrypted_value,
  data_type = source.data_type,
  is_sensitive = source.is_sensitive,
  is_required = source.is_required,
  validation_status = source.validation_status,
  validation_message = source.validation_message,
  last_validated_at = source.last_validated_at,
  default_value = source.default_value,
  description = source.description,
  updated_at = NOW()
FROM system_settings AS source
WHERE source.category = 'openclaw'
  AND source.key IN (
    'yeahpromos_token',
    'yeahpromos_site_id',
    'partnerboost_token',
    'partnerboost_base_url',
    'openclaw_affiliate_sync_interval_hours',
    'openclaw_affiliate_sync_mode'
  )
  AND target.category = 'affiliate_sync'
  AND target.key = source.key
  AND target.user_id IS NOT DISTINCT FROM source.user_id;

INSERT INTO system_settings (
  user_id,
  category,
  key,
  value,
  encrypted_value,
  data_type,
  is_sensitive,
  is_required,
  validation_status,
  validation_message,
  last_validated_at,
  default_value,
  description,
  created_at,
  updated_at
)
SELECT
  source.user_id,
  'affiliate_sync' AS category,
  source.key,
  source.value,
  source.encrypted_value,
  source.data_type,
  source.is_sensitive,
  source.is_required,
  source.validation_status,
  source.validation_message,
  source.last_validated_at,
  source.default_value,
  source.description,
  source.created_at,
  NOW()
FROM system_settings AS source
LEFT JOIN system_settings AS target
  ON target.category = 'affiliate_sync'
  AND target.key = source.key
  AND target.user_id IS NOT DISTINCT FROM source.user_id
WHERE source.category = 'openclaw'
  AND source.key IN (
    'yeahpromos_token',
    'yeahpromos_site_id',
    'partnerboost_token',
    'partnerboost_base_url',
    'openclaw_affiliate_sync_interval_hours',
    'openclaw_affiliate_sync_mode'
  )
  AND target.id IS NULL;

DELETE FROM system_settings
WHERE category = 'openclaw'
  AND key IN (
    'yeahpromos_token',
    'yeahpromos_site_id',
    'partnerboost_token',
    'partnerboost_base_url',
    'openclaw_affiliate_sync_enabled',
    'openclaw_affiliate_sync_interval_hours',
    'openclaw_affiliate_sync_mode'
  );
