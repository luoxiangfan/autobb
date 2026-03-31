-- Migration: 217_ad_creative_generation_v5.3_header_fix.sql
-- Description: ad_creative_generation v5.3 - fix stale v5.0 header text in prompt_content
-- Date: 2026-03-24
-- Database: SQLite

-- 1) 修正 v5.3 prompt 内容头部版本标识（仅文本修正，不改变规则本体）
UPDATE prompt_versions
SET prompt_content = REPLACE(
  REPLACE(
    prompt_content,
    '-- Google Ads 广告创意生成 v5.0 (Intent-Driven)',
    '-- Google Ads 广告创意生成 v5.3 (Intent-Driven + Protected Slots)'
  ),
  '-- 注意：本版本通过代码动态注入intent sections，prompt_content保持v4.48基础',
  '-- 注意：当前版本在 v5.0 动态注入基础上增加 Top Headlines 保护与 retained slots 约束'
)
WHERE prompt_id = 'ad_creative_generation'
  AND version = 'v5.3';

-- 2) 保持 v5.3 为激活版本（幂等）
UPDATE prompt_versions
SET is_active = 1
WHERE prompt_id = 'ad_creative_generation' AND version = 'v5.3';
