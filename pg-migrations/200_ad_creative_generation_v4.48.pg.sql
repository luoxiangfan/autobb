-- Migration: 200_ad_creative_generation_v4.48.pg.sql
-- Description: ad_creative_generation v4.48 - 负向信号禁用与信任表达增强
-- Date: 2026-03-04
-- Database: PostgreSQL

-- 1) 取消当前激活版本
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'ad_creative_generation' AND is_active = TRUE;

-- 2) 基于 v4.47 生成 v4.48（幂等）
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
  'v4.48',
  base.category,
  '广告创意生成v4.48 - 负向信号禁用与信任表达增强',
  '新增负向信号禁用规则，抑制弱排名背书、虚构社证比例、低信任俚语与强负向施压表达，提升创意相关性与转化质量',
  'prompts/ad_creative_generation_v4.48.txt',
  base.function_name,
  REPLACE(
    REPLACE(
      REPLACE(
        base.prompt_content,
        '-- Google Ads 广告创意生成 v4.47',
        '-- Google Ads 广告创意生成 v4.48'
      ),
      '-- v4.47: 恢复排除关键词占位并保留类型意图引导',
      '-- v4.48: 新增负向信号禁用规则，降低弱排名/虚构社证/低信任措辞'
    ),
    '- EXTRACTED 元素仅用于措辞参考，不得引入任何数字/承诺/限时/库存信息

## 关键词使用规则',
    '- EXTRACTED 元素仅用于措辞参考，不得引入任何数字/承诺/限时/库存信息

## 🚫 负向信号与低信任表达禁用（CRITICAL）
以下表达禁止出现在 headline/description/sitelink/callout：
- 弱势排名背书：如 `#18,696 Best Seller`、`#12,000 in Category`、`Top #xxxx`
- 未经证据的排名/Best Seller：只有 VERIFIED FACTS 明确给出且排名 ≤ #1000 才可使用
- 编造社会证明比例：如 `92% of women love it`、`87% users recommend`
- 低信任俚语/口语：如 `cuz` / `gonna` / `kinda` / `awesome` / `ain''t`
- 强负向情绪施压：如 `panic` / `ashamed` / `humiliated` / `desperate` / `disaster` / `suffering`
- 场景错配维修/工具词：如 `reliable fix for real projects`、`tackle repairs`、`repair`、`tool`、`workshop`（除非产品本身属于该类目）

替代表达原则：
- 使用中性、可验证、与商品强相关的价值表达（如 comfort/fit/breathable/supportive）
- 痛点表达仅允许“轻痛点 + 解决方案”，禁止羞辱、恐惧、灾难化措辞

## 关键词使用规则'
  ),
  base.language,
  base.created_by,
  TRUE,
  $$v4.48:
1. 新增“负向信号与低信任表达禁用”规则，限制弱排名/虚构社证比例/低信任俚语
2. 增加强负向施压措辞约束，要求使用“轻痛点 + 解决方案”表达
3. 保持既有KISS-3类型与关键词嵌入结构不变，仅做最小提示词增强
$$,
  '2026-03-04 12:30:00'
FROM prompt_versions base
WHERE base.prompt_id = 'ad_creative_generation' AND base.version = 'v4.47'
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
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.48';
