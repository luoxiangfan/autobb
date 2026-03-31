-- Migration: 159_add_data_sync_mode_template.sql
-- Date: 2026-02-06
-- Description: 添加 system.data_sync_mode 全局模板，修复 settings 保存时报“配置项不存在”
-- Note: SQLite 版本，使用 INSERT OR IGNORE 实现幂等插入

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
  'system',
  'data_sync_mode',
  NULL,
  NULL,
  'incremental',
  '手动同步默认模式（incremental/full）',
  0,
  0,
  'string'
);
