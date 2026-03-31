-- Migration: Add unique constraint to system_settings (FIXED VERSION)
-- Purpose: Prevent duplicate (category, key) entries with non-empty values
-- IMPORTANT: This version preserves global templates (user_id IS NULL, value = NULL)
-- Date: 2025-12-20 (Fixed)

-- Step 1: Clean up duplicate user configuration records only
-- Remove duplicate user configurations, but preserve global templates
DELETE FROM system_settings
WHERE id IN (
  SELECT s1.id
  FROM system_settings s1
  JOIN system_settings s2
    ON s1.category = s2.category
    AND s1.key = s2.key
    AND s1.user_id IS NOT NULL  -- Only delete user configurations
    AND s2.user_id IS NOT NULL  -- Only delete user configurations
    AND s1.value IS NOT NULL
    AND s1.value <> ''
    AND s2.value IS NOT NULL
    AND s2.value <> ''
    AND s1.updated_at < s2.updated_at  -- Keep the latest record
);

-- Step 2: Remove empty/null user configurations (but NOT global templates)
DELETE FROM system_settings
WHERE user_id IS NOT NULL  -- Only delete user configurations
  AND (value IS NULL OR value = '');

-- Step 3: Create unique partial index to prevent future duplicates
-- This index only applies to records with non-empty values
-- Global templates (value = NULL) and user configurations (value = JSON) can coexist
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_settings_category_key_unique
  ON system_settings(category, key)
  WHERE value IS NOT NULL AND value <> '';

-- Verification queries (commented out for production)
-- Check for duplicates in non-null values
-- SELECT category, key, COUNT(*) as count
-- FROM system_settings
-- WHERE value IS NOT NULL AND value <> ''
-- GROUP BY category, key
-- HAVING COUNT(*) > 1;

-- Check global templates exist
-- SELECT category, key, 'Global Template' as type
-- FROM system_settings
-- WHERE user_id IS NULL
-- GROUP BY category, key
-- ORDER BY category, key;
