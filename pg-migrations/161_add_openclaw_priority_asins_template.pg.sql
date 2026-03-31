-- Migration: 161_add_openclaw_priority_asins_template.pg.sql
-- Date: 2026-02-06
-- Description: 为 OpenClaw 策略补充 priority ASIN 列表模板配置
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
  'openclaw_strategy_priority_asins',
  NULL,
  NULL,
  '[]',
  'Priority ASIN 列表（JSON 数组），用于策略执行时优先投放',
  false,
  false,
  'json'
WHERE NOT EXISTS (
  SELECT 1
  FROM system_settings
  WHERE category = 'openclaw' AND key = 'openclaw_strategy_priority_asins' AND user_id IS NULL
);
