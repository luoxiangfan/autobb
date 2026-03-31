-- Migration: 162_add_openclaw_enforce_autoads_only_template.pg.sql
-- Date: 2026-02-06
-- Description: 增加 OpenClaw 仅允许 AutoAds 发布链路的策略模板配置
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
  'openclaw_strategy_enforce_autoads_only',
  NULL,
  NULL,
  'true',
  '仅允许通过AutoAds标准接口创建/发布广告，不允许手工Campaign并行',
  false,
  false,
  'boolean'
WHERE NOT EXISTS (
  SELECT 1
  FROM system_settings
  WHERE category = 'openclaw' AND key = 'openclaw_strategy_enforce_autoads_only' AND user_id IS NULL
);
