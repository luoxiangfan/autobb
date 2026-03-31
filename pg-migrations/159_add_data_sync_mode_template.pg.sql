-- Migration: 159_add_data_sync_mode_template.pg.sql
-- Date: 2026-02-06
-- Description: 添加 system.data_sync_mode 全局模板，修复 settings 保存时报“配置项不存在”
-- Note: PostgreSQL 版本，使用 INSERT ... WHERE NOT EXISTS 实现幂等插入

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
  'system',
  'data_sync_mode',
  NULL,
  NULL,
  'incremental',
  '手动同步默认模式（incremental/full）',
  false,
  false,
  'string'
WHERE NOT EXISTS (
  SELECT 1
  FROM system_settings
  WHERE category = 'system' AND key = 'data_sync_mode' AND user_id IS NULL
);
