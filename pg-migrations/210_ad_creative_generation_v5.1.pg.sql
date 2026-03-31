-- Migration: 210_ad_creative_generation_v5.1.pg.sql
-- Description: ad_creative_generation v5.1 - Canonical intent structured output
-- Date: 2026-03-16
-- Database: PostgreSQL

-- 1) 取消当前激活版本
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'ad_creative_generation' AND is_active = TRUE;

-- 2) 基于 v5.0 生成 v5.1（幂等）
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
  'v5.1',
  base.category,
  '广告创意生成v5.1 - Canonical Intent Structured Output',
  '补充 canonical intent 结构化输出约束：在不改变现有 RSA 资产结构的前提下，附带 evidenceProducts / keywordCandidates / cannotGenerateReason 等审计元信息。',
  'prompts/ad_creative_generation_v5.1.txt',
  base.function_name,
  REPLACE(
    base.prompt_content,
    '{{output_format_section}}',
    E'{{output_format_section}}\n\n## Structured Evidence Metadata (recommended)\n- In addition to RSA assets, also return structured evidence metadata whenever it is available.\n- evidenceProducts: only verified current product names or verified hot product names actually used in copy.\n- keywordCandidates: optional audit metadata only; include text plus sourceType / anchorType / qualityReason when available.\n- cannotGenerateReason: if verified product or model evidence is insufficient, return a concise reason instead of inventing unsupported models, series, functions, or product lines.\n- Never fabricate evidenceProducts, keywordCandidates, or cannotGenerateReason.'
  ),
  base.language,
  base.created_by,
  TRUE,
  $$v5.1 - Canonical Intent Structured Output:
1. 为 ad_creative_generation 补充结构化审计输出约束，允许附带 evidenceProducts / keywordCandidates / cannotGenerateReason
2. 明确禁止在证据不足时编造型号、系列、功能词或商品线
3. 不改变现有 RSA 资产必填结构，只新增可选审计元信息
$$,
  '2026-03-16 23:55:00'
FROM prompt_versions base
WHERE base.prompt_id = 'ad_creative_generation' AND base.version = 'v5.0'
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
WHERE prompt_id = 'ad_creative_generation' AND version = 'v5.1';
