-- Migration: 172_add_openclaw_affiliate_sync_settings.sql
-- Date: 2026-02-09
-- Description: 增加 OpenClaw 联盟成交/佣金同步配置模板（启用开关、间隔、模式）
-- Note: SQLite 版本，使用 INSERT OR IGNORE 保持幂等

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
    'openclaw',
    'openclaw_affiliate_sync_enabled',
    NULL,
    NULL,
    'false',
    '启用联盟成交/佣金自动同步（按间隔刷新当日快照）',
    0,
    0,
    'boolean'
  ),
  (
    'openclaw',
    'openclaw_affiliate_sync_interval_hours',
    NULL,
    NULL,
    '1',
    '联盟成交/佣金自动同步间隔（小时，建议 1-24）',
    0,
    0,
    'number'
  ),
  (
    'openclaw',
    'openclaw_affiliate_sync_mode',
    NULL,
    NULL,
    'incremental',
    '联盟成交/佣金同步模式（incremental/realtime）',
    0,
    0,
    'string'
  );
