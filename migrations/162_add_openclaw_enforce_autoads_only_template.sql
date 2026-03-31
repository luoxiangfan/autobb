-- Migration: 162_add_openclaw_enforce_autoads_only_template.sql
-- Date: 2026-02-06
-- Description: 增加 OpenClaw 仅允许 AutoAds 发布链路的策略模板配置
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
  'openclaw_strategy_enforce_autoads_only',
  NULL,
  NULL,
  'true',
  '仅允许通过AutoAds标准接口创建/发布广告，不允许手工Campaign并行',
  0,
  0,
  'boolean'
);
