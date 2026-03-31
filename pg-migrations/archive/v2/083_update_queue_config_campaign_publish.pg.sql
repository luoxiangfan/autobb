-- Migration: Update queue config to include campaign-publish task type
-- Description: Add campaign-publish to perTypeConcurrency configuration
-- Date: 2025-12-19
-- Affected: system_settings table (queue config)

-- Update queue configuration to include campaign-publish task type
UPDATE system_settings
SET
  value = jsonb_set(
    value::jsonb,
    '{perTypeConcurrency,campaign-publish}',
    '2'::jsonb
  )::text,
  updated_at = NOW()
WHERE
  category = 'queue'
  AND key = 'config'
  AND user_id IS NULL
  AND (value::jsonb->'perTypeConcurrency'->>'campaign-publish') IS NULL;

-- Verification query
-- This should return the updated config with campaign-publish
SELECT value
FROM system_settings
WHERE category = 'queue' AND key = 'config' AND user_id IS NULL;

-- Expected result: perTypeConcurrency should include "campaign-publish": 2
