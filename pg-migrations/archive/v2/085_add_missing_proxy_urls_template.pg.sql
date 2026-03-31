-- Migration: Add missing proxy.urls global template (PostgreSQL)
-- Purpose: Insert the missing global template record for proxy.urls configuration
-- Date: 2025-12-20

-- Insert the global template for proxy.urls if it doesn't exist
-- PostgreSQL uses WHERE NOT EXISTS pattern instead of INSERT OR IGNORE
INSERT INTO system_settings (
  user_id,
  category,
  key,
  value,
  data_type,
  is_sensitive,
  is_required,
  description
)
SELECT
  NULL,
  'proxy',
  'urls',
  NULL,
  'json',
  false,
  false,
  '代理URL配置，JSON格式存储国家与代理URL的映射'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE category = 'proxy'
    AND key = 'urls'
    AND user_id IS NULL
);

-- Verification query (commented out for production)
-- SELECT user_id, category, key, value, data_type, description
-- FROM system_settings
-- WHERE category = 'proxy' AND key = 'urls';
