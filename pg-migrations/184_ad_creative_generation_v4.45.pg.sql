-- Migration: 184_ad_creative_generation_v4.45.pg.sql
-- Description: ad_creative_generation v4.45 - 价格证据冲突防护
-- Date: 2026-02-21
-- Database: PostgreSQL

-- 1) 取消当前激活版本
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'ad_creative_generation' AND is_active = TRUE;

-- 2) 基于 v4.44 生成 v4.45（幂等）
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
  'v4.45',
  base.category,
  '广告创意生成v4.45 - 价格证据冲突防护',
  '新增 PRICE EVIDENCE BLOCKED 规则，价格证据冲突时禁止金额表述',
  'prompts/ad_creative_generation_v4.45.txt',
  base.function_name,
  REPLACE(
    REPLACE(
      REPLACE(
        base.prompt_content,
        '-- Google Ads 广告创意生成 v4.44',
        '-- Google Ads 广告创意生成 v4.45'
      ),
      '-- v4.44: Amazon Title/About this item 信号强利用 + 创意元素覆盖约束',
      '-- v4.45: 增加价格证据冲突防护（PRICE EVIDENCE BLOCKED）'
    ),
    '- 若 VERIFIED FACTS 为空：禁止出现任何数字/促销/运费/保障/时效承诺，只能用非数值、非承诺的价值型表述
- EXTRACTED 元素仅用于措辞参考，不得引入任何数字/承诺/限时/库存信息',
    '- 若 VERIFIED FACTS 为空：禁止出现任何数字/促销/运费/保障/时效承诺，只能用非数值、非承诺的价值型表述
- 若 VERIFIED FACTS 中出现 `PRICE EVIDENCE BLOCKED`：禁止输出任何具体金额（包括当前价/原价/折扣额），仅可使用非金额价值表达
- EXTRACTED 元素仅用于措辞参考，不得引入任何数字/承诺/限时/库存信息'
  ),
  base.language,
  base.created_by,
  TRUE,
  $$v4.45:
1. 新增 PRICE EVIDENCE BLOCKED 规则：价格证据冲突时禁止具体金额
2. 强化 Evidence-Only 价格边界，避免抓取异常价格进入创意
$$,
  '2026-02-21 22:00:00'
FROM prompt_versions base
WHERE base.prompt_id = 'ad_creative_generation' AND base.version = 'v4.44'
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
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.45';
