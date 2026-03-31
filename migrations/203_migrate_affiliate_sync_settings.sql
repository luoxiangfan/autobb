-- Migration: 203_migrate_affiliate_sync_settings.sql
-- Date: 2026-03-06
-- Description: 将联盟凭证与佣金同步配置从 openclaw 分类迁移到 affiliate_sync 分类，并移除旧开关键

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
    'affiliate_sync',
    'yeahpromos_token',
    NULL,
    NULL,
    NULL,
    'YeahPromos API Token',
    1,
    0,
    'string'
  ),
  (
    'affiliate_sync',
    'yeahpromos_site_id',
    NULL,
    NULL,
    NULL,
    'YeahPromos Site ID',
    0,
    0,
    'string'
  ),
  (
    'affiliate_sync',
    'partnerboost_token',
    NULL,
    NULL,
    NULL,
    'PartnerBoost API Token',
    1,
    0,
    'string'
  ),
  (
    'affiliate_sync',
    'partnerboost_base_url',
    NULL,
    NULL,
    'https://app.partnerboost.com',
    'PartnerBoost API Base URL',
    0,
    0,
    'string'
  ),
  (
    'affiliate_sync',
    'openclaw_affiliate_sync_interval_hours',
    NULL,
    NULL,
    '1',
    '联盟佣金自动同步间隔（小时，建议 1-24）',
    0,
    0,
    'number'
  ),
  (
    'affiliate_sync',
    'openclaw_affiliate_sync_mode',
    NULL,
    NULL,
    'incremental',
    '联盟佣金同步模式（incremental/realtime）',
    0,
    0,
    'string'
  );

INSERT OR IGNORE INTO system_settings (
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
  user_id,
  'affiliate_sync' AS category,
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
FROM system_settings
WHERE category = 'openclaw'
  AND key IN (
    'yeahpromos_token',
    'yeahpromos_site_id',
    'partnerboost_token',
    'partnerboost_base_url',
    'openclaw_affiliate_sync_interval_hours',
    'openclaw_affiliate_sync_mode'
  );

UPDATE system_settings
SET
  value = (
    SELECT source.value
    FROM system_settings source
    WHERE source.category = 'openclaw'
      AND source.key = system_settings.key
      AND (source.user_id = system_settings.user_id OR (source.user_id IS NULL AND system_settings.user_id IS NULL))
    LIMIT 1
  ),
  encrypted_value = (
    SELECT source.encrypted_value
    FROM system_settings source
    WHERE source.category = 'openclaw'
      AND source.key = system_settings.key
      AND (source.user_id = system_settings.user_id OR (source.user_id IS NULL AND system_settings.user_id IS NULL))
    LIMIT 1
  ),
  data_type = COALESCE((
    SELECT source.data_type
    FROM system_settings source
    WHERE source.category = 'openclaw'
      AND source.key = system_settings.key
      AND (source.user_id = system_settings.user_id OR (source.user_id IS NULL AND system_settings.user_id IS NULL))
    LIMIT 1
  ), data_type),
  is_sensitive = COALESCE((
    SELECT source.is_sensitive
    FROM system_settings source
    WHERE source.category = 'openclaw'
      AND source.key = system_settings.key
      AND (source.user_id = system_settings.user_id OR (source.user_id IS NULL AND system_settings.user_id IS NULL))
    LIMIT 1
  ), is_sensitive),
  is_required = COALESCE((
    SELECT source.is_required
    FROM system_settings source
    WHERE source.category = 'openclaw'
      AND source.key = system_settings.key
      AND (source.user_id = system_settings.user_id OR (source.user_id IS NULL AND system_settings.user_id IS NULL))
    LIMIT 1
  ), is_required),
  validation_status = (
    SELECT source.validation_status
    FROM system_settings source
    WHERE source.category = 'openclaw'
      AND source.key = system_settings.key
      AND (source.user_id = system_settings.user_id OR (source.user_id IS NULL AND system_settings.user_id IS NULL))
    LIMIT 1
  ),
  validation_message = (
    SELECT source.validation_message
    FROM system_settings source
    WHERE source.category = 'openclaw'
      AND source.key = system_settings.key
      AND (source.user_id = system_settings.user_id OR (source.user_id IS NULL AND system_settings.user_id IS NULL))
    LIMIT 1
  ),
  last_validated_at = (
    SELECT source.last_validated_at
    FROM system_settings source
    WHERE source.category = 'openclaw'
      AND source.key = system_settings.key
      AND (source.user_id = system_settings.user_id OR (source.user_id IS NULL AND system_settings.user_id IS NULL))
    LIMIT 1
  ),
  default_value = COALESCE((
    SELECT source.default_value
    FROM system_settings source
    WHERE source.category = 'openclaw'
      AND source.key = system_settings.key
      AND (source.user_id = system_settings.user_id OR (source.user_id IS NULL AND system_settings.user_id IS NULL))
    LIMIT 1
  ), default_value),
  description = COALESCE((
    SELECT source.description
    FROM system_settings source
    WHERE source.category = 'openclaw'
      AND source.key = system_settings.key
      AND (source.user_id = system_settings.user_id OR (source.user_id IS NULL AND system_settings.user_id IS NULL))
    LIMIT 1
  ), description),
  updated_at = datetime('now')
WHERE category = 'affiliate_sync'
  AND key IN (
    'yeahpromos_token',
    'yeahpromos_site_id',
    'partnerboost_token',
    'partnerboost_base_url',
    'openclaw_affiliate_sync_interval_hours',
    'openclaw_affiliate_sync_mode'
  )
  AND EXISTS (
    SELECT 1
    FROM system_settings source
    WHERE source.category = 'openclaw'
      AND source.key = system_settings.key
      AND (source.user_id = system_settings.user_id OR (source.user_id IS NULL AND system_settings.user_id IS NULL))
  );

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
