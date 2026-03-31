-- Migration: 133_add_data_sync_global_templates.sql
-- Date: 2026-01-07
-- Description: 添加 data_sync_enabled 和 data_sync_interval_hours 的全局模板记录
-- Note: SQLite 版本，使用 INSERT OR IGNORE 实现幂等插入

-- 添加 data_sync_enabled 全局模板
INSERT OR IGNORE INTO system_settings (category, key, user_id, value, description, is_sensitive, data_type)
VALUES ('system', 'data_sync_enabled', NULL, NULL, '启用自动数据同步', 0, 'boolean');

-- 添加 data_sync_interval_hours 全局模板
INSERT OR IGNORE INTO system_settings (category, key, user_id, value, description, is_sensitive, data_type)
VALUES ('system', 'data_sync_interval_hours', NULL, NULL, '数据同步间隔（小时）', 0, 'number');
