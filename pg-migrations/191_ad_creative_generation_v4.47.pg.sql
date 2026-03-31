-- Migration: 191_ad_creative_generation_v4.47.pg.sql
-- Description: ad_creative_generation v4.47 - 恢复排除关键词占位
-- Date: 2026-02-25
-- Database: PostgreSQL

-- 1) 取消当前激活版本
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'ad_creative_generation' AND is_active = TRUE;

-- 2) 基于 v4.46 生成 v4.47（幂等）
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  created_by,
  is_active,
  change_notes,
  created_at
)
SELECT
  'ad_creative_generation',
  'v4.47',
  base.category,
  '广告创意生成v4.47 - 恢复排除关键词占位',
  '在保持 type_intent_guidance_section 的同时恢复 exclude_keywords_section，确保搜索词硬排除和已用词抑制可生效',
  'prompts/ad_creative_generation_v4.47.txt',
  base.function_name,
  REPLACE(
    REPLACE(
      REPLACE(
        base.prompt_content,
        '-- Google Ads 广告创意生成 v4.46',
        '-- Google Ads 广告创意生成 v4.47'
      ),
      '-- v4.46: 增加类型意图引导占位（不改变关键词策略）',
      '-- v4.47: 恢复排除关键词占位并保留类型意图引导'
    ),
    '{{keyword_bucket_section}}
{{bucket_info_section}}
{{type_intent_guidance_section}}',
    '{{keyword_bucket_section}}
{{bucket_info_section}}
{{type_intent_guidance_section}}
{{exclude_keywords_section}}'
  ),
  base.language,
  base.created_by,
  TRUE,
  $$v4.47:
1. 恢复 {{exclude_keywords_section}} 占位，接入已用关键词/搜索词硬排除/软抑制提示
2. 保留 {{type_intent_guidance_section}}，不改变现有类型意图引导结构
3. 仅调整提示词模板占位，不改动业务路由和评分逻辑
$$,
  '2026-02-25 18:30:00'
FROM prompt_versions base
WHERE base.prompt_id = 'ad_creative_generation' AND base.version = 'v4.46'
ON CONFLICT (prompt_id, version)
DO UPDATE SET
  category = EXCLUDED.category,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  file_path = EXCLUDED.file_path,
  function_name = EXCLUDED.function_name,
  prompt_content = EXCLUDED.prompt_content,
  language = EXCLUDED.language,
  created_by = EXCLUDED.created_by,
  is_active = EXCLUDED.is_active,
  change_notes = EXCLUDED.change_notes,
  created_at = EXCLUDED.created_at;

-- 3) 确保新版本激活
UPDATE prompt_versions
SET is_active = TRUE
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.47';
