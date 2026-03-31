-- Migration: Fix unique constraint for system_settings (PostgreSQL)
-- Purpose: Ensure global templates are also unique, not just user configurations
-- Date: 2025-12-20

-- Step 1: Clean up duplicate global templates
-- Keep only one global template per (category, key)
DELETE FROM system_settings s1
WHERE s1.user_id IS NULL
  AND s1.value IS NULL
  AND EXISTS (
    SELECT 1 FROM system_settings s2
    WHERE s2.category = s1.category
      AND s2.key = s1.key
      AND s2.user_id IS NULL
      AND s2.value IS NULL
      AND s2.id < s1.id  -- Keep the record with the smallest ID
  );

-- Step 2: Create more comprehensive unique constraints
-- Drop the existing partial index
DROP INDEX IF EXISTS idx_system_settings_category_key_unique;

-- Create a unique index for user configurations
-- This ensures each user can have only one config per (category, key)
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
