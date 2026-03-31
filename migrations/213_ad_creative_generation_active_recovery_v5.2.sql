-- Migration: 213_ad_creative_generation_active_recovery_v5.2.sql
-- Description: Recover ad_creative_generation active version and bootstrap v5.2 when dependency chain is missing
-- Date: 2026-03-18
-- Database: SQLite

-- 1) 基于可用基线补齐/更新 v5.2（优先 v5.1，其次 v5.0，再其次最新版本）
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
  (SELECT id FROM prompt_versions WHERE prompt_id = 'ad_creative_generation' AND version = 'v5.2'),
  'ad_creative_generation',
  'v5.2',
  base.category,
  '广告创意生成v5.2 - Title Priority Top Headlines',
  '恢复并强化 Headline #2-#4 的 title 优先抽取规则：优先从 product title 提炼，title 不足时才回退 about/features，并要求语义去重与 30 字符限制。',
  'prompts/ad_creative_generation_v5.2.txt',
  base.function_name,
  CASE
    WHEN instr(base.prompt_content, '### Headline #2-#4（TITLE PRIORITY, CRITICAL）') > 0 THEN base.prompt_content
    WHEN instr(base.prompt_content, '### DKI使用限制（CRITICAL）') > 0 THEN REPLACE(
      base.prompt_content,
      '### DKI使用限制（CRITICAL）',
      '### Headline #2-#4（TITLE PRIORITY, CRITICAL）
- 必须优先从 `EXTRACTED PRODUCT TITLE` / `TITLE CORE PHRASES` 提炼 3 条 headline 候选（对应 #2-#4）
- 每条必须包含品牌词（完整品牌或可识别品牌 token），且必须 ≤30 字符
- 3 条 headline 必须语义去重（不能仅换词序/近义词微调）
- 若 TITLE 已能产出 3 条高质量候选：不得混入 ABOUT/FEATURES
- 仅当 TITLE 候选不足 3 条时，才允许从 `ABOUT THIS ITEM CORE CLAIMS` / `PRODUCT FEATURES` 补齐
- 可为满足 30 字符与品牌约束做压缩（缩写、去冗余词、单位紧凑写法），但不得改变核心卖点
- 该规则对 Product Link 与 Store Link 都适用

### DKI使用限制（CRITICAL）'
    )
    ELSE base.prompt_content ||
      '

### Headline #2-#4（TITLE PRIORITY, CRITICAL）
- 必须优先从 `EXTRACTED PRODUCT TITLE` / `TITLE CORE PHRASES` 提炼 3 条 headline 候选（对应 #2-#4）
- 每条必须包含品牌词（完整品牌或可识别品牌 token），且必须 ≤30 字符
- 3 条 headline 必须语义去重（不能仅换词序/近义词微调）
- 若 TITLE 已能产出 3 条高质量候选：不得混入 ABOUT/FEATURES
- 仅当 TITLE 候选不足 3 条时，才允许从 `ABOUT THIS ITEM CORE CLAIMS` / `PRODUCT FEATURES` 补齐
- 可为满足 30 字符与品牌约束做压缩（缩写、去冗余词、单位紧凑写法），但不得改变核心卖点
- 该规则对 Product Link 与 Store Link 都适用
'
  END,
  base.language,
  base.created_by,
  1,
  REPLACE('v5.2 active recovery:
1. 当 v5.0 / v5.1 依赖链缺失时，允许从当前可用基线补齐/更新 v5.2
2. 强制恢复 ad_creative_generation 至“至少一个激活版本”
3. 激活策略优先 v5.2，若 v5.2 不可用则回退最新版本，避免创意队列因无 active prompt 失败
', '
', char(10)),
  datetime('now')
FROM (
  SELECT *
  FROM prompt_versions
  WHERE prompt_id = 'ad_creative_generation'
  ORDER BY
    CASE
      WHEN version = 'v5.1' THEN 0
      WHEN version = 'v5.0' THEN 1
      ELSE 2
    END,
    created_at DESC,
    id DESC
  LIMIT 1
) base;

-- 2) 重置激活态
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_creative_generation';

-- 3) 优先激活 v5.2
UPDATE prompt_versions
SET is_active = 1
WHERE prompt_id = 'ad_creative_generation' AND version = 'v5.2';

-- 4) 若 v5.2 不存在，则兜底激活最新版本（保证至少一个 active）
UPDATE prompt_versions
SET is_active = 1
WHERE id = (
  SELECT id
  FROM prompt_versions
  WHERE prompt_id = 'ad_creative_generation'
  ORDER BY created_at DESC, id DESC
  LIMIT 1
)
AND NOT EXISTS (
  SELECT 1
  FROM prompt_versions
  WHERE prompt_id = 'ad_creative_generation' AND is_active = 1
);
