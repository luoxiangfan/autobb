-- 256: Migrate legacy system.sync_interval_hours user overrides to data_sync_interval_hours
-- Scheduler reads only data_sync_interval_hours after this migration.

INSERT INTO system_settings (
  user_id,
  category,
  key,
  value,
  data_type,
  is_sensitive,
  is_required,
  description,
  created_at,
  updated_at
)
SELECT
  legacy.user_id,
  'system',
  'data_sync_interval_hours',
  legacy.value,
  COALESCE(legacy.data_type, 'number'),
  COALESCE(legacy.is_sensitive, FALSE),
  COALESCE(legacy.is_required, FALSE),
  COALESCE(legacy.description, '数据同步间隔（小时）'),
  legacy.created_at,
  CURRENT_TIMESTAMP
FROM system_settings legacy
WHERE legacy.category = 'system'
  AND legacy.key = 'sync_interval_hours'
  AND legacy.user_id IS NOT NULL
  AND legacy.value IS NOT NULL
  AND TRIM(legacy.value) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM system_settings current
    WHERE current.user_id = legacy.user_id
      AND current.category = 'system'
      AND current.key = 'data_sync_interval_hours'
  );

DELETE FROM system_settings
WHERE category = 'system'
  AND key = 'sync_interval_hours'
  AND user_id IS NOT NULL;
