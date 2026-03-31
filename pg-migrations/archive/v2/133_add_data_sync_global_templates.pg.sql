-- Migration: 133_add_data_sync_global_templates.pg.sql
-- Date: 2026-01-07
-- Description: 添加 data_sync_enabled 和 data_sync_interval_hours 的全局模板记录
-- Note: PostgreSQL 版本，使用 INSERT ... WHERE NOT EXISTS 实现幂等插入

-- 添加 data_sync_enabled 全局模板
INSERT INTO system_settings (category, key, user_id, value, description, is_sensitive, data_type)
SELECT 'system', 'data_sync_enabled', NULL, NULL, '启用自动数据同步', false, 'boolean'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE category = 'system' AND key = 'data_sync_enabled' AND user_id IS NULL
);

-- 添加 data_sync_interval_hours 全局模板
INSERT INTO system_settings (category, key, user_id, value, description, is_sensitive, data_type)
SELECT 'system', 'data_sync_interval_hours', NULL, NULL, '数据同步间隔（小时）', false, 'number'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE category = 'system' AND key = 'data_sync_interval_hours' AND user_id IS NULL
);
