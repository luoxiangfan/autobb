-- Migration: 172_add_openclaw_affiliate_sync_settings.pg.sql
-- Date: 2026-02-09
-- Description: 增加 OpenClaw 联盟成交/佣金同步配置模板（启用开关、间隔、模式）
-- Note: PostgreSQL 版本，使用 INSERT ... WHERE NOT EXISTS 保持幂等

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
  'openclaw',
  'openclaw_affiliate_sync_enabled',
  NULL,
  NULL,
  'false',
  '启用联盟成交/佣金自动同步（按间隔刷新当日快照）',
  false,
  false,
  'boolean'
WHERE NOT EXISTS (
  SELECT 1
  FROM system_settings
  WHERE category = 'openclaw' AND key = 'openclaw_affiliate_sync_enabled' AND user_id IS NULL
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
  'openclaw',
  'openclaw_affiliate_sync_interval_hours',
  NULL,
  NULL,
  '1',
  '联盟成交/佣金自动同步间隔（小时，建议 1-24）',
  false,
  false,
  'number'
WHERE NOT EXISTS (
  SELECT 1
  FROM system_settings
  WHERE category = 'openclaw' AND key = 'openclaw_affiliate_sync_interval_hours' AND user_id IS NULL
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
  'openclaw',
  'openclaw_affiliate_sync_mode',
  NULL,
  NULL,
  'incremental',
  '联盟成交/佣金同步模式（incremental/realtime）',
  false,
  false,
  'string'
WHERE NOT EXISTS (
  SELECT 1
  FROM system_settings
  WHERE category = 'openclaw' AND key = 'openclaw_affiliate_sync_mode' AND user_id IS NULL
);
