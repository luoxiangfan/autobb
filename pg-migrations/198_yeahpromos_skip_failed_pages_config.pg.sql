-- Migration: 198_yeahpromos_skip_failed_pages_config.pg.sql
-- Date: 2026-03-03
-- Description: 添加 YeahPromos 跳过失败页面的配置选项

-- 为所有用户添加默认配置（默认启用跳过失败页面）
INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, created_at, updated_at)
SELECT
  id as user_id,
  'openclaw' as category,
  'yeahpromos_skip_failed_pages' as key,
  'true' as value,
  'string' as data_type,
  false as is_sensitive,
  false as is_required,
  CURRENT_TIMESTAMP as created_at,
  CURRENT_TIMESTAMP as updated_at
FROM users
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE system_settings.user_id = users.id
  AND system_settings.key = 'yeahpromos_skip_failed_pages'
);
