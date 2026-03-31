-- Migration: 161_add_openclaw_priority_asins_template.sql
-- Date: 2026-02-06
-- Description: 为 OpenClaw 策略补充 priority ASIN 列表模板配置
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
VALUES (
  'openclaw',
  'openclaw_strategy_priority_asins',
  NULL,
  NULL,
  '[]',
  'Priority ASIN 列表（JSON 数组），用于策略执行时优先投放',
  0,
  0,
  'json'
);
