-- Migration: 185_ad_creative_generation_v4.46.sql
-- Description: ad_creative_generation v4.46 - 类型意图引导占位
-- Date: 2026-02-21
-- Database: SQLite

-- 1) 取消当前激活版本
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_creative_generation' AND is_active = 1;

-- 2) 基于 v4.45 生成 v4.46（幂等）
INSERT OR REPLACE INTO prompt_versions (
  id,
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
  (SELECT id FROM prompt_versions WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.46'),
  'ad_creative_generation',
  'v4.46',
  base.category,
  '广告创意生成v4.46 - 类型意图引导占位',
  '新增 type_intent_guidance_section 占位，增强A/B/D表达引导且不改变关键词策略',
  'prompts/ad_creative_generation_v4.46.txt',
  base.function_name,
  replace(
    replace(
      replace(
        base.prompt_content,
        '-- Google Ads 广告创意生成 v4.45',
        '-- Google Ads 广告创意生成 v4.46'
      ),
      '-- v4.45: 增加价格证据冲突防护（PRICE EVIDENCE BLOCKED）',
      '-- v4.46: 增加类型意图引导占位（不改变关键词策略）'
    ),
    '{{ai_keywords_section}}
{{keyword_bucket_section}}
{{bucket_info_section}}',
    '{{ai_keywords_section}}
{{keyword_bucket_section}}
{{bucket_info_section}}
{{type_intent_guidance_section}}'
  ),
  base.language,
  base.created_by,
  1,
  replace('v4.46:
1. 新增 {{type_intent_guidance_section}} 占位，注入A/B/D类型意图引导
2. 仅优化标题/描述表达权重，不改变关键词生成、筛选、定稿策略
3. 保持与既有创意类型兼容，作为非阻断式软约束
',
'
', char(10)),
  '2026-02-21 23:30:00'
FROM prompt_versions base
WHERE base.prompt_id = 'ad_creative_generation' AND base.version = 'v4.45';

-- 3) 确保新版本激活
UPDATE prompt_versions
SET is_active = 1
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.46';
