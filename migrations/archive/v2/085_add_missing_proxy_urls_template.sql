-- Migration: Add missing proxy.urls global template (SQLite)
-- Purpose: Insert the missing global template record for proxy.urls configuration
-- Date: 2025-12-20

-- Insert the global template for proxy.urls if it doesn't exist
-- SQLite uses INSERT OR IGNORE which is equivalent to PostgreSQL's WHERE NOT EXISTS
INSERT OR IGNORE INTO system_settings (
  user_id,
  category,
  key,
  value,
  data_type,
  is_sensitive,
  is_required,
  description
) VALUES (
  NULL,
  'proxy',
  'urls',
  NULL,
  'json',
  0,
  0,
  '代理URL配置，JSON格式存储国家与代理URL的映射'
);

-- Verification query (commented out for production)
-- SELECT user_id, category, key, value, data_type, description
-- FROM system_settings
-- WHERE category = 'proxy' AND key = 'urls';
