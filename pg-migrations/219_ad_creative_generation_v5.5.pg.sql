-- Migration: 219_ad_creative_generation_v5.5.pg.sql
-- Description: ad_creative_generation v5.5 - Headline semantic completeness & attraction hardening
-- Date: 2026-03-26
-- Database: PostgreSQL

-- 1) 取消当前激活版本
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'ad_creative_generation' AND is_active = TRUE;

-- 2) 基于 v5.4 生成 v5.5（幂等）
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
  'v5.5',
  base.category,
  '广告创意生成v5.5 - Headline Semantic Completeness & Attraction',
  '强化Headline #2-#9语义完整与吸引力门槛，禁止尾残句/尾标点与关键词堆叠式短语。',
  'prompts/ad_creative_generation_v5.5.txt',
  base.function_name,
  REPLACE(
    REPLACE(
      REPLACE(
        base.prompt_content,
        '-- Google Ads 广告创意生成 v5.4',
        '-- Google Ads 广告创意生成 v5.5'
      ),
      '-- v5.4: 新增竞争定位强化规则，要求输出价格优势/价值表达/对比表达，提升 Ad Strength 竞争定位维度',
      E'-- v5.4: 新增竞争定位强化规则，要求输出价格优势/价值表达/对比表达，提升 Ad Strength 竞争定位维度\n-- v5.5: 强化 Headline #2-#9 语义完整与吸引力门槛，禁止尾残句/尾标点，避免关键词堆叠式短语'
    ),
    '### Headline #2-#4（TITLE PRIORITY, IMMUTABLE, CRITICAL）',
    $$### Headline #2-#9（QUALITY BAR, CRITICAL）
- 每条 headline 必须是可独立理解的完整表达，禁止半句、残句、拼接词串
- 每条 headline 必须包含“利益点/价值点/行动导向”三者之一，避免仅关键词堆叠
- 禁止以下悬空尾词结尾：`with` / `and` / `&` / `for` / `to` / `from` / `of` / `in` / `on` / `at` / `by`（或目标语言等价虚词）
- 禁止以尾标点收尾：`,` `;` `:` `-` `/` `|` `&` `+`
- 若关键词难以自然融入，必须先重写为完整短句，再校验长度；禁止“硬截断保长”

### Headline #2-#4（TITLE PRIORITY, IMMUTABLE, CRITICAL）$$
  ),
  base.language,
  base.created_by,
  TRUE,
  $$v5.5 - Headline Semantic Completeness & Attraction:
1. 升级主Prompt到 ad_creative_generation v5.5，不新增独立prompt_id
2. 新增 Headline #2-#9 统一质量门槛：语义完整、可读可用、具备吸引力
3. 明确禁止尾残句、尾标点、关键词堆叠式短语
4. 保持原有硬约束不变：DKI首条、#2-#4保护槽、#5-#9保留词落位合同
$$,
  '2026-03-26 22:20:00'
FROM prompt_versions base
WHERE base.prompt_id = 'ad_creative_generation' AND base.version = 'v5.4'
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

-- 3) 确保最终版本激活
UPDATE prompt_versions
SET is_active = TRUE
WHERE prompt_id = 'ad_creative_generation' AND version = 'v5.5';
