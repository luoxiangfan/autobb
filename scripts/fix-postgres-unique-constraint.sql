-- Emergency Fix Script for PostgreSQL Unique Constraint Conflict
-- Purpose: Fix the system_settings table to resolve proxy.urls constraint violation
-- Date: 2025-12-20
-- Usage: Execute this script on the PostgreSQL database

-- =====================================================
-- Step 1: Check current data state
-- =====================================================

-- Check proxy.urls records
SELECT
  id,
  user_id,
  category,
  key,
  CASE
    WHEN value IS NULL THEN 'NULL'
    WHEN value = '' THEN 'EMPTY_STRING'
    ELSE 'HAS_VALUE(' || LENGTH(value) || ' chars)'
  END as value_status,
  data_type,
  is_sensitive,
  is_required,
  created_at,
  updated_at
FROM system_settings
WHERE category = 'proxy' AND key = 'urls'
ORDER BY user_id, updated_at;

-- Check for any duplicates in non-null values across all settings
SELECT
  category,
  key,
  COUNT(*) as duplicate_count
FROM system_settings
WHERE value IS NOT NULL AND value <> ''
GROUP BY category, key
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- =====================================================
-- Step 2: Restore missing global template for proxy.urls
-- =====================================================

-- Insert global template if it doesn't exist
INSERT INTO system_settings (
  user_id,
  category,
  key,
  value,
  encrypted_value,
  data_type,
  is_sensitive,
  is_required,
  description,
  created_at,
  updated_at
)
SELECT
  NULL,
  'proxy',
  'urls',
  NULL,
  NULL,
  'json',
  false,
  false,
  '代理URL配置，JSON格式存储国家与代理URL的映射',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE category = 'proxy'
    AND key = 'urls'
    AND user_id IS NULL
);

-- =====================================================
-- Step 3: Clean up any remaining duplicate user configurations
-- =====================================================

-- Delete older duplicate user configurations
DELETE FROM system_settings s1
WHERE s1.user_id IS NOT NULL
  AND s1.value IS NOT NULL
  AND s1.value <> ''
  AND EXISTS (
    SELECT 1 FROM system_settings s2
    WHERE s2.category = s1.category
      AND s2.key = s1.key
      AND s2.user_id = s1.user_id
      AND s2.value IS NOT NULL
      AND s2.value <> ''
      AND s2.updated_at > s1.updated_at
      AND s2.id != s1.id
  );

-- =====================================================
-- Step 4: Verify the fix
-- =====================================================

-- Verify proxy.urls now has correct structure
SELECT
  user_id,
  category,
  key,
  CASE
    WHEN value IS NULL THEN 'NULL'
    ELSE 'HAS_VALUE'
  END as value_status,
  data_type
FROM system_settings
WHERE category = 'proxy' AND key = 'urls'
ORDER BY user_id;

-- Check no duplicates exist in non-null values
SELECT
  category,
  key,
  COUNT(*) as count
FROM system_settings
WHERE value IS NOT NULL AND value <> ''
GROUP BY category, key
HAVING COUNT(*) > 1;

-- If this query returns 0 rows, no duplicates exist

-- =====================================================
-- Step 5: Test the unique constraint
-- =====================================================

-- Try to insert a duplicate user configuration (should fail)
-- This is just a test - we'll roll it back
BEGIN;

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
VALUES (
  999,  -- Test user ID
  'proxy',
  'urls',
  '{"test": "value"}',
  'json',
  false,
  false,
  'Test duplicate'
);

-- This should fail with unique constraint violation
-- If it does, the constraint is working correctly

ROLLBACK;

-- =====================================================
-- Summary
-- =====================================================

-- Final verification
SELECT
  'Total proxy.urls records' as check_type,
  COUNT(*) as count
FROM system_settings
WHERE category = 'proxy' AND key = 'urls'

UNION ALL

SELECT
  'Global templates' as check_type,
  COUNT(*) as count
FROM system_settings
WHERE user_id IS NULL

UNION ALL

SELECT
  'User configurations' as check_type,
  COUNT(*) as count
FROM system_settings
WHERE user_id IS NOT NULL;

-- Expected result:
-- - Total proxy.urls records: 2 (1 global template + 1 or more user configs)
-- - Global templates: 1 (or more, one for each setting)
-- - User configurations: variable (depends on number of users)
