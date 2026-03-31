-- Migration: 212_ad_creative_generation_v5.2.pg.sql
-- Description: ad_creative_generation v5.2 - Title-priority Top Headlines (#2-#4)
-- Date: 2026-03-17
-- Database: PostgreSQL

-- 1) 取消当前激活版本
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'ad_creative_generation' AND is_active = TRUE;

-- 2) 基于 v5.1 生成 v5.2（幂等）
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
  'v5.2',
  base.category,
  '广告创意生成v5.2 - Title Priority Top Headlines',
  '新增 Headline #2-#4 的 title 优先抽取规则：优先从 product title 提炼并保持品牌约束，title 不足时才回退 about/features，同时要求语义去重与 30 字符限制。',
  'prompts/ad_creative_generation_v5.2.txt',
  base.function_name,
  REPLACE(
    base.prompt_content,
    '### DKI使用限制（CRITICAL）',
    E'### Headline #2-#4（TITLE PRIORITY, CRITICAL）\n- 必须优先从 `EXTRACTED PRODUCT TITLE` / `TITLE CORE PHRASES` 提炼 3 条 headline 候选（对应 #2-#4）\n- 每条必须包含品牌词（完整品牌或可识别品牌 token），且必须 ≤30 字符\n- 3 条 headline 必须语义去重（不能仅换词序/近义词微调）\n- 若 TITLE 已能产出 3 条高质量候选：不得混入 ABOUT/FEATURES\n- 仅当 TITLE 候选不足 3 条时，才允许从 `ABOUT THIS ITEM CORE CLAIMS` / `PRODUCT FEATURES` 补齐\n- 可为满足 30 字符与品牌约束做压缩（缩写、去冗余词、单位紧凑写法），但不得改变核心卖点\n- 该规则对 Product Link 与 Store Link 都适用\n\n### DKI使用限制（CRITICAL）'
  ),
  base.language,
  base.created_by,
  TRUE,
  $$v5.2 - Title Priority Top Headlines:
1. 新增 Headline #2-#4 必须优先从 TITLE 信号抽取的规则，确保品牌词与 <=30 字符限制
2. 明确 title 足够时禁止混入 about/features，title 不足时才允许 fallback
3. 增加语义去重要求，避免 #2-#4 仅做词序或同义词层面的伪差异
$$,
  '2026-03-17 21:10:00'
FROM prompt_versions base
WHERE base.prompt_id = 'ad_creative_generation' AND base.version = 'v5.1'
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
WHERE prompt_id = 'ad_creative_generation' AND version = 'v5.2';
