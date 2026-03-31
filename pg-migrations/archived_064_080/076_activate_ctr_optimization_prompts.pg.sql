-- Migration: 激活CTR优化相关prompt的最新版本
-- Date: 2025-12-13
-- Description: 激活广告创意生成、标题生成、描述生成的最新CTR优化版本
-- Background: 发现这3个prompt的最新版本(v4.6, v3.3, v3.3)未激活，需要手动激活

-- Step 1: 禁用所有旧版本
UPDATE prompt_versions SET is_active = false
WHERE prompt_id IN ('ad_creative_generation', 'ad_elements_headlines', 'ad_elements_descriptions');

-- Step 2: 激活最新版本
UPDATE prompt_versions SET is_active = true
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.6';

UPDATE prompt_versions SET is_active = true
WHERE prompt_id = 'ad_elements_headlines' AND version = 'v3.3';

UPDATE prompt_versions SET is_active = true
WHERE prompt_id = 'ad_elements_descriptions' AND version = 'v3.3';

-- Verification: Check active prompts
-- SELECT prompt_id, name, version, is_active FROM prompt_versions
-- WHERE prompt_id IN ('ad_creative_generation', 'ad_elements_headlines', 'ad_elements_descriptions')
-- ORDER BY prompt_id, version DESC;
