-- Migration: 080_activate_ad_creative_v4.8.pg.sql (PostgreSQL版本)
-- Description: 激活广告创意生成v4.8 - 关键词嵌入率强化版
-- Date: 2024-12-14

-- 先停用当前激活的版本
UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'ad_creative_generation' AND is_active = true;

-- 激活v4.8
UPDATE prompt_versions
SET is_active = true
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.8';

-- 验证结果
SELECT id, name, version, is_active
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY version DESC LIMIT 3;
