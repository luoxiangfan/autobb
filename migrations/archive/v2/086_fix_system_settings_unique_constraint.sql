-- Migration: Fix unique constraint for system_settings (SQLite)
-- Purpose: Ensure global templates are also unique, not just user configurations
-- Date: 2025-12-20

-- Step 1: Clean up duplicate global templates
-- Keep only one global template per (category, key)
DELETE FROM system_settings
WHERE id NOT IN (
  SELECT MIN(id)
  FROM system_settings
  WHERE user_id IS NULL
  GROUP BY category, key
);

-- Step 2: Create a more comprehensive unique constraint
-- This ensures both global templates (value = NULL) and user configs (value = JSON) are unique

-- First, drop the existing partial index
DROP INDEX IF EXISTS idx_system_settings_category_key_unique;

-- Create a new unique index that handles both cases
-- For records with non-NULL values, use the standard unique constraint
-- For global templates (user_id IS NULL, value IS NULL), we need a different approach

-- Create a unique index for user configurations
CREATE UNIQUE INDEX idx_system_settings_user_config_unique
  ON system_settings(category, key, user_id)
  WHERE user_id IS NOT NULL AND value IS NOT NULL AND value <> '';

-- Create a unique index for global templates
-- This ensures only one global template per (category, key)
CREATE UNIQUE INDEX idx_system_settings_global_template_unique
  ON system_settings(category, key)
  WHERE user_id IS NULL AND value IS NULL;

-- Verification queries (commented out for production)
-- Check global templates are unique
-- SELECT category, key, COUNT(*) as count
-- FROM system_settings
-- WHERE user_id IS NULL AND value IS NULL
-- GROUP BY category, key
-- HAVING COUNT(*) > 1;

-- Check user configurations are unique per user
-- SELECT category, key, user_id, COUNT(*) as count
-- FROM system_settings
-- WHERE user_id IS NOT NULL AND value IS NOT NULL AND value <> ''
-- GROUP BY category, key, user_id
-- HAVING COUNT(*) > 1;
