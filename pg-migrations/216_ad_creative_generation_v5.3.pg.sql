-- Migration: 216_ad_creative_generation_v5.3.pg.sql
-- Description: ad_creative_generation v5.3 - retained keyword contract with protected top headlines
-- Date: 2026-03-22
-- Database: PostgreSQL

-- 1) 取消当前激活版本
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'ad_creative_generation' AND is_active = TRUE;

-- 2) 基于 v5.2 生成最终版 v5.3（幂等）
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
  'v5.3',
  base.category,
  '广告创意生成v5.3 - Protected Top Headlines + Diverse Retained Slots',
  '保护 Headline #1-#4 不被 retained keyword contract 覆盖，将保留关键词 headline 后移到 #5-#9，并要求与前4条 headline 保持多样性。',
  'prompts/ad_creative_generation_v5.3.txt',
  base.function_name,
  REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(
            base.prompt_content,
            '-- Google Ads 广告创意生成 v5.2',
            '-- Google Ads 广告创意生成 v5.3'
          ),
          '-- v5.2: 新增 Headline #2-#4 的 Title 优先抽取规则（含品牌、长度、语义去重、About/Features fallback）',
          '-- v5.3: Headline #1-#4 保护不动，retained keyword headlines 后移到 #5-#9，并要求与前4条保持多样性；低质量/无语义关键词不得强制落位'
        ),
        '{{exclude_keywords_section}}',
        E'{{exclude_keywords_section}}\n\n## 最终保留词落位规则（CRITICAL）\n{{retained_keyword_slot_section}}'
      ),
      $$**关键词嵌入规则**：
- 8/15 (53%+) 标题必须包含关键词
- 4/4 (100%) 描述必须包含关键词
- 优先使用搜索量更高的关键词
- 品牌词必须至少出现在2个标题中
**硬性要求**：如未达到8/15关键词嵌入率，必须重写标题直到达标$$,
      $$**关键词嵌入规则**：
- 8/15 (53%+) 标题必须包含关键词
- 4/4 (100%) 描述必须包含关键词
- 优先使用搜索量更高的关键词
- 品牌词必须至少出现在2个标题中
- Headline #1 是固定 DKI，Headline #2-#4 是固定 title/about headline，不得改写；当提供最终保留下来的非纯品牌词计划时，Headline #5-#9 与 Description #1-#2 必须优先遵守该计划
- 如果保留下来的合格关键词不足 5 个，则所有合格关键词都必须进入 Headline #5-#9，并允许复用更高优先级的保留词补齐剩余 headline slot
- 如果保留下来的合格关键词超过 5 个，则只把优先级与质量最好的 5 个放入 Headline #5-#9
- 如果没有合格的保留词，禁止为了达标硬塞低质量、无语义或不自然的关键词
**硬性要求**：如未达到8/15关键词嵌入率，必须重写标题直到达标$$
    ),
    $$### Headline #2-#4（TITLE PRIORITY, CRITICAL）
- 必须优先从 `EXTRACTED PRODUCT TITLE` / `TITLE CORE PHRASES` 提炼 3 条 headline 候选（对应 #2-#4）
- 每条必须包含品牌词（完整品牌或可识别品牌 token），且必须 ≤30 字符
- 3 条 headline 必须语义去重（不能仅换词序/近义词微调）
- 若 TITLE 已能产出 3 条高质量候选：不得混入 ABOUT/FEATURES
- 仅当 TITLE 候选不足 3 条时，才允许从 `ABOUT THIS ITEM CORE CLAIMS` / `PRODUCT FEATURES` 补齐
- 可为满足 30 字符与品牌约束做压缩（缩写、去冗余词、单位紧凑写法），但不得改变核心卖点
- 该规则对 Product Link 与 Store Link 都适用$$,
    $$### Headline #2-#4（TITLE PRIORITY, IMMUTABLE, CRITICAL）
- 必须优先从 `EXTRACTED PRODUCT TITLE` / `TITLE CORE PHRASES` 提炼 3 条 headline 候选（对应 #2-#4）
- 这 3 条 headline 为 title/about 保护槽位，不得被 retained keyword contract 覆盖或改写
- 每条必须包含品牌词（完整品牌或可识别品牌 token），且必须 ≤30 字符
- 3 条 headline 必须语义去重（不能仅换词序/近义词微调）
- 若 TITLE 已能产出 3 条高质量候选：不得混入 ABOUT/FEATURES
- 仅当 TITLE 候选不足 3 条时，才允许从 `ABOUT THIS ITEM CORE CLAIMS` / `PRODUCT FEATURES` 补齐

### Headline #5-#9（RETAINED KEYWORD SLOTS, CRITICAL）
- 这些 headline 是最终保留下来的非纯品牌词落位区，必须优先遵守 `FINAL RETAINED NON-BRAND KEYWORD` / `RETAINED KEYWORD SLOT PLAN`
- 每条 headline 必须自然完整、≤30 字符，并优先围绕对应保留词组织表达
- 必须与 Headline #1-#4 保持明显差异，禁止对 DKI headline 或 title/about headline 做近似复写、轻改写或轻度词序调整
- TITLE / ABOUT / FEATURES 只能帮助润色和补证据，不能覆盖已给出的 retained keyword slot contract
- 若某个保留词无法自然融入 headline 且会明显破坏文案质量，不要生造、截断或输出无语义短语
- 若未提供安全的 retained keyword plan，则回退到高质量自然 headline，不强制硬塞关键词$$
  ),
  base.language,
  base.created_by,
  TRUE,
  $$v5.3 - Protected Top Headlines + Diverse Retained Slots:
1. Headline #1 仍固定 DKI，Headline #2-#4 固定为 title/about 保护槽位，不允许 retained keyword 覆盖
2. retained keyword headline 槽位后移到 Headline #5-#9，Description #1-#2 继续优先使用 retained keyword
3. 新增多样性约束：Headline #5-#9 不得与 Headline #1-#4 形成近似复写
4. 低质量、无语义、无法自然融入文案的关键词不得被强制写入 headline/description
$$,
  '2026-03-22 12:45:00'
FROM prompt_versions base
WHERE base.prompt_id = 'ad_creative_generation' AND base.version = 'v5.2'
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

-- 3) 补充 Description #1-#2 retained keyword slot 规则（幂等）
UPDATE prompt_versions
SET prompt_content = REPLACE(
  prompt_content,
  $$**单品页限制**：产品页不得使用“explore our collection/store”等店铺引导措辞

### 描述结构（必须覆盖）$$,
  $$**单品页限制**：产品页不得使用“explore our collection/store”等店铺引导措辞

### Description #1-#2（RETAINED KEYWORD SLOTS, CRITICAL）
- 当提供 retained keyword slot plan 时，Description #1-#2 必须优先覆盖这些最终保留词
- 优先使用尚未被 Headline #5-#9 覆盖的 retained keyword；若都已覆盖，可复用优先级更高的 retained keyword
- 描述必须自然、完整、以 CTA 结尾，不得为了塞词而输出不通顺或无语义的句子

### 描述结构（必须覆盖）$$
)
WHERE prompt_id = 'ad_creative_generation' AND version = 'v5.3';

-- 4) 确保最终版本激活
UPDATE prompt_versions
SET is_active = TRUE
WHERE prompt_id = 'ad_creative_generation' AND version = 'v5.3';
