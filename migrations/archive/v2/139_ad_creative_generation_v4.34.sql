-- Migration: 139_ad_creative_generation_v4.34.sql
-- Description: ad_creative_generation v4.34 - KISS-3类型 + 证据约束 + Headline#2主关键词
-- Date: 2026-01-14
-- Database: SQLite

-- 1) 取消当前激活版本
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_creative_generation' AND is_active = 1;

-- 2) 幂等写入新版本（若已存在则更新内容）
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
  change_notes
) VALUES (
  'ad_creative_generation',
  'v4.34',
  '广告创意生成',
  '广告创意生成v4.34 - KISS 3类型+证据约束',
  '收敛为3个用户可见创意类型（A/B/D），强化证据约束，新增Headline#2主关键词且不含品牌',
  'prompts/ad_creative_generation_v4.34.txt',
  'buildAdCreativePrompt',
  '-- ============================================
-- Google Ads 广告创意生成 v4.34
-- KISS-3类型：A(品牌/信任) + B(场景+功能) + D(转化/价值)
-- 强制证据约束 + Headline#2 主关键词规则
-- ============================================

## 任务
为 Google Ads 生成高质量的广告创意（Responsive Search Ads）。

## ⚠️ 字符限制（CRITICAL - 必须严格遵守）
生成时必须控制长度，不得依赖后端截断：
- Headlines：每个≤30字符（含空格、标点）
- Descriptions：每个≤90字符（含空格、标点）
- Callouts：每个≤25字符
- Sitelink text：每个≤25字符
- Sitelink description：每个≤35字符

## 基本要求
1. 所有内容必须使用目标语言：{{target_language}}
2. 固定数量：15个标题，4个描述，15个关键词，6个Callouts，6个Sitelinks
3. 所有创意元素必须与单品/店铺链接类型一致
4. 每个元素必须语义完整，不得因字符限制而截断句子

## 语言指令
{{language_instruction}}

## 产品/店铺信息
{{link_type_section}}

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}

{{enhanced_features_section}}
{{localization_section}}
{{brand_analysis_section}}
{{extras_data}}

{{verified_facts_section}}

{{promotion_section}}
{{theme_section}}
{{reference_performance_section}}
{{extracted_elements_section}}

## ✅ Evidence-Only Claims（CRITICAL）
你必须严格遵守以下规则，避免虚假陈述：
- 只能使用“VERIFIED FACTS”中出现过的数字、折扣、限时、保障/支持承诺、覆盖范围、速度/时长等可验证信息
- 如果VERIFIED FACTS中没有对应信息：不得编造，不得“默认有”，改用不含数字/不含承诺的表述
- 不得写“24/7”“X分钟开通”“覆盖X国”“X%折扣”“退款保证”“终身”等，除非VERIFIED FACTS明确提供

## 关键词使用规则
{{ai_keywords_section}}
{{keyword_bucket_section}}
{{bucket_info_section}}

**关键词嵌入规则**：
- 8/15 (53%+) 标题必须包含关键词
- 4/4 (100%) 描述必须包含关键词
- 优先使用搜索量更高的关键词
- 品牌词必须至少出现在2个标题中

## 标题规则（15个，≤30字符）

### Headline #1（MANDATORY）
- 必须是：{KeyWord:{{brand}}} Official（如超长则允许仅 {KeyWord:{{brand}}}）
- 仅Headline #1允许使用 {KeyWord:...}（其他标题禁止使用DKI格式）

### Headline #2（MANDATORY）
- 必须自然包含主关键词：{{primary_keyword}}
- 必须不包含品牌词（避免与Headline #1重复）
- 不得使用DKI格式

### 标题类型分布（保持多样性）
使用以下指导生成剩余标题，避免重复表达：
{{headline_brand_guidance}}
{{headline_feature_guidance}}
{{headline_promo_guidance}}
{{headline_cta_guidance}}
{{headline_urgency_guidance}}

**问题型标题（必需）**：
- 至少2个标题为问题句（以?结尾），用于刺痛/共鸣（但不得编造事实）

## 描述规则（4个，≤90字符）
要求：每条描述都必须包含关键词，并以“目标语言的CTA”结尾（不得混语言）。

### 描述结构（必须覆盖）
{{description_1_guidance}}
{{description_2_guidance}}
{{description_3_guidance}}
{{description_4_guidance}}

**Pain → Solution（必需）**：
- 至少1条描述必须按：痛点短句 → 解决方案 →（若有）证据点 → CTA
- 证据点只能来自 VERIFIED FACTS / PROMOTION / EXTRACTED 元素

## Callouts（6个，≤25字符）
{{callout_guidance}}

## 桶类型适配（KISS-3类型）
根据 {{bucket_type}} 调整创意角度：

### 桶A（品牌/信任）
- 强调官方、正品、可信、保障（仅限证据内）
- 品牌词覆盖更高，但避免标题重复

### 桶B（场景+功能）
- 用“场景/痛点”开头，再用“功能/卖点”给出解决方案
- 允许不提品牌（Headline #2 必须不提品牌）

### 桶D（转化/价值）
- 优先突出可验证的优惠/价值点 + 强行动号召
- 若无证据，不写折扣/限时/数字，只写“价值/省心/替代方案”类表述

## 输出（JSON only）
{{output_format_section}}',
  'Chinese',
  1,
  1,
  'v4.34:
1) 仅3个用户可见创意类型（A/B/D），C->B、S->D
2) 强制证据约束（VERIFIED FACTS），禁止编造数字/承诺
3) Headline #1 固定DKI品牌；Headline #2 必须用主关键词且不含品牌
4) 描述CTA要求：使用目标语言（不混语言）'
)
ON CONFLICT(prompt_id, version) DO UPDATE SET
  category = EXCLUDED.category,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  file_path = EXCLUDED.file_path,
  function_name = EXCLUDED.function_name,
  prompt_content = EXCLUDED.prompt_content,
  language = EXCLUDED.language,
  change_notes = EXCLUDED.change_notes,
  is_active = EXCLUDED.is_active;

-- 3) 激活新版本
UPDATE prompt_versions
SET is_active = 1
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.34';
