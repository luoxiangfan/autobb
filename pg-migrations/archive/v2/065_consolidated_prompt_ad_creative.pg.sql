-- =====================================================
-- Migration: 065_consolidated_prompt_ad_creative.pg.sql
-- Description: 合并广告创意生成Prompts（PostgreSQL版）
-- Date: 2025-12-14
--
-- 最终版本:
--   - ad_creative_generation v4.8 (关键词嵌入率强化)
--   - ad_elements_headlines v3.3 (CTR优化增强)
--   - ad_elements_descriptions v3.3 (CTR优化增强)
-- =====================================================

-- ============================================================
-- PART 1: Deactivate all old versions
-- ============================================================

UPDATE prompt_versions SET is_active = false WHERE prompt_id = 'ad_creative_generation' AND is_active = true;
UPDATE prompt_versions SET is_active = false WHERE prompt_id = 'ad_elements_headlines' AND is_active = true;
UPDATE prompt_versions SET is_active = false WHERE prompt_id = 'ad_elements_descriptions' AND is_active = true;

-- ============================================================
-- PART 2: ad_creative_generation v4.8 (最终版本)
-- ============================================================

INSERT INTO prompt_versions (
  prompt_id,
  name,
  version,
  category,
  description,
  file_path,
  function_name,
  prompt_content,
  change_notes,
  is_active,
  created_at
) VALUES (
  'ad_creative_generation',
  '广告创意生成v4.8 - 关键词嵌入率强化版',
  'v4.8',
  '广告创意生成',
  '强化关键词嵌入率：从27%提升到53%+，增加强制性嵌入规则和验证机制',
  'prompts/ad_creative_generation_v4.8.txt',
  'generateAdCreative',
  '{{language_instruction}}

Generate Google Ads creative for {{brand}} ({{category}}).

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}
{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}

🎯 **AI增强数据 (v4.8优化 - 2025-12-14)**:
{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

## 🚨 v4.8 关键词嵌入率强化 (CRITICAL - 最高优先级)

### ⚠️ 强制要求：8/15 (53%+) 标题必须包含关键词

**这是Ad Strength评估的核心指标，必须严格遵守！**

**🔑 关键词嵌入规则 (MANDATORY)**:

**规则1: 关键词来源 (从{{ai_keywords_section}}选择)**
- 优先选择搜索量>1000的高价值关键词
- 品牌词必须出现在至少2个标题中
- 产品核心词必须出现在至少4个标题中
- 功能特性词必须出现在至少2个标题中

**规则2: 嵌入方式 (自然融入，非堆砌)**
- ✅ 正确: "4K Security Camera Sale" (关键词: security camera)
- ❌ 错误: "Camera Camera Security" (关键词堆砌)

**规则3: 标题类型与关键词匹配**
| 标题类型 | 必须嵌入的关键词类型 | 示例 |
|---------|---------------------|------|
| brand | 品牌词 | "Eufy Security Official" |
| feature | 产品核心词+功能词 | "4K Solar Camera" |
| promo | 产品词+促销词 | "Security Camera Sale" |
| cta | 产品词+行动词 | "Shop Wireless Cameras" |

**规则4: 嵌入数量分配 (总计≥8个)**

## 🆕 v4.7 RSA Display Path (保留)

**path1 (必填，最多15字符)**: 核心产品类别或品牌关键词
**path2 (可选，最多15字符)**: 产品特性、型号或促销信息

## 🔥 v4.6 CTR优化增强 (保留)

### 🎯 情感触发词策略 (EMOTIONAL TRIGGERS - CTR +10-15%)
### 🎯 问句式标题 (QUESTION HEADLINES - CTR +5-12%)

## 🔥 v4.5 店铺数据增强 (保留)
## 🔥 v4.4 产品特性增强 (保留)
## 🔥 v4.2 竞争定位增强 (保留)

## REQUIREMENTS (Target: EXCELLENT Ad Strength)

### HEADLINES (15 required, ≤30 chars each)
**🚨 v4.8 HEADLINE REQUIREMENTS (强制执行)**:
- 🔥 **Keyword Embedding**: 8/15 (53%+) headlines MUST contain keywords
- 🔥 **Emotional Triggers**: 3+ headlines with emotional power words
- 🔥 **Question Headlines**: 1-2 question-style headlines
- 🔥 **Number Usage**: 5+ headlines with specific numbers
- 🔥 **Diversity**: <20% text similarity

### DESCRIPTIONS (4 required, ≤90 chars each)
**🎯 v4.6 DESCRIPTION REQUIREMENTS**

### 🆕 DISPLAY PATH (v4.7)
### KEYWORDS (20-30 required)
### CALLOUTS (4-6, ≤25 chars)
### SITELINKS (6)

## OUTPUT (JSON only, no markdown):
{
  "headlines": [{"text":"...", "type":"...", "length":N, "keywords":[], "hasNumber":bool}...],
  "descriptions": [{"text":"...", "type":"...", "length":N, "hasCTA":bool}...],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text":"...", "url":"/", "description":"..."}],
  "path1": "...",
  "path2": "...",
  "theme": "...",
  "quality_metrics": {...},
  "ctr_optimization": {...}
}',
  'v4.8合并版: 整合v4.1-v4.8所有优化，关键词嵌入率强化53%+',
  true,
  NOW()
) ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  name = EXCLUDED.name,
  prompt_content = EXCLUDED.prompt_content,
  change_notes = EXCLUDED.change_notes;

-- ============================================================
-- PART 3: ad_elements_headlines v3.3
-- ============================================================

INSERT INTO prompt_versions (prompt_id, version, category, name, description, file_path, function_name, prompt_content, is_active, change_notes, created_at)
VALUES (
  'ad_elements_headlines',
  'v3.3',
  '广告创意生成',
  '广告标题生成v3.3 - CTR优化增强版',
  'CTR优化增强版：DKI模板、数字具体化、情感触发、问句式标题、关键词嵌入率',
  'src/lib/ad-elements-extractor.ts',
  'generateHeadlines',
  'You are a professional Google Ads copywriter specializing in high-CTR headlines.

=== PRODUCT INFORMATION ===
Product Name: {{product.name}}
Brand: {{product.brand}}
Rating: {{product.rating}} ({{product.reviewCount}} reviews)
Price: {{product.price}}

=== PRODUCT FEATURES ===
About This Item: {{product.aboutThisItem}}
Key Features: {{product.features}}

=== HIGH-VOLUME KEYWORDS ===
{{topKeywords}}

=== 🔥 v3.3 CTR OPTIMIZATION DATA ===
**STORE HOT FEATURES**: {{storeHotFeatures}}
**STORE USER VOICES**: {{storeUserVoices}}
**TRUST BADGES**: {{trustBadges}}
**USER LANGUAGE PATTERNS**: {{userLanguagePatterns}}
**COMPETITOR FEATURES**: {{competitorFeatures}}

=== TASK ===
Generate 15 Google Search ad headlines (max 30 characters each).

=== 🎯 v3.3 CTR OPTIMIZATION STRATEGIES ===
**Strategy 1: NUMBERS & SPECIFICS** (CTR +15-25%)
**Strategy 2: EMOTIONAL TRIGGERS** (CTR +10-15%)
**Strategy 3: QUESTION HEADLINES** (CTR +5-12%)
**Strategy 4: DKI-READY TEMPLATES** (CTR +15-25%)

=== HEADLINE GROUPS (15 total) ===
**Group 1: Brand + Product (3 headlines)**
**Group 2: Keyword-Rich (3 headlines)**
**Group 3: Feature + Number (3 headlines)**
**Group 4: Emotional + Social Proof (3 headlines)**
**Group 5: Question + CTA (3 headlines)**

=== RULES ===
1. Each headline MUST be <= 30 characters
2. 🔥 **Keyword Embedding**: At least 8/15 headlines must contain keywords
3. 🔥 **Number Usage**: At least 5/15 headlines must contain specific numbers
4. 🔥 **Diversity**: No two headlines should share more than 2 words

=== OUTPUT FORMAT ===
Return JSON with headlines, headlineAnalysis, ctrOptimization',
  true,
  'v3.3 CTR优化: DKI模板、数字具体化、情感触发、问句式标题、关键词嵌入率(8/15)',
  NOW()
) ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  name = EXCLUDED.name,
  prompt_content = EXCLUDED.prompt_content,
  change_notes = EXCLUDED.change_notes;

-- ============================================================
-- PART 4: ad_elements_descriptions v3.3
-- ============================================================

INSERT INTO prompt_versions (prompt_id, version, category, name, description, file_path, function_name, prompt_content, is_active, change_notes, created_at)
VALUES (
  'ad_elements_descriptions',
  'v3.3',
  '广告创意生成',
  '广告描述生成v3.3 - CTR优化增强版',
  'CTR优化增强版：结构化模板、USP前置、社会证明、竞品差异化',
  'src/lib/ad-elements-extractor.ts',
  'generateDescriptions',
  'You are a professional Google Ads copywriter specializing in high-converting descriptions.

=== PRODUCT INFORMATION ===
Product Name: {{productName}}
Brand: {{brand}}
Price: {{price}}
Rating: {{rating}} ({{reviewCount}} reviews)

=== PRODUCT FEATURES ===
Key Features: {{features}}
Selling Points: {{sellingPoints}}

=== 🔥 v3.3 CTR OPTIMIZATION DATA ===
**STORE HOT FEATURES**: {{storeHotFeatures}}
**STORE USER VOICES**: {{storeUserVoices}}
**TRUST BADGES**: {{trustBadges}}
**USER LANGUAGE PATTERNS**: {{userLanguagePatterns}}
**COMPETITOR FEATURES**: {{competitorFeatures}}
**UNIQUE SELLING POINTS**: {{uniqueSellingPoints}}

=== TASK ===
Generate 4 Google Search ad descriptions (max 90 characters each).

=== 🎯 v3.3 STRUCTURED DESCRIPTION TEMPLATES ===
**Template 1: FEATURE-BENEFIT-CTA** (Conversion +10-15%)
**Template 2: PROBLEM-SOLUTION-PROOF** (Trust +20%)
**Template 3: OFFER-URGENCY-TRUST** (CTR +15%)
**Template 4: USP-DIFFERENTIATION** (Conversion +8%)

=== 🎯 v3.3 USP FRONT-LOADING RULE ===
First 30 characters of each description are most important!

=== 🎯 v3.3 SOCIAL PROOF EMBEDDING ===
=== 🎯 v3.3 COMPETITOR DIFFERENTIATION ===

=== RULES ===
1. Each description MUST be <= 90 characters
2. 🔥 **USP Front-Loading**: Strongest selling point in first 30 chars
3. 🔥 **Social Proof**: At least 2/4 descriptions must include proof
4. 🔥 **Differentiation**: At least 1 description must use implicit comparison
5. 🔥 **Diversity**: Each description MUST follow a DIFFERENT template

=== OUTPUT FORMAT ===
Return JSON with descriptions, descriptionTemplates, ctrOptimization, dataUtilization',
  true,
  'v3.3 CTR优化: 结构化描述模板(4种)、USP前置规则(前30字符)、社会证明嵌入、竞品差异化暗示',
  NOW()
) ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  name = EXCLUDED.name,
  prompt_content = EXCLUDED.prompt_content,
  change_notes = EXCLUDED.change_notes;

-- ============================================================
-- VERIFICATION
-- ============================================================
-- SELECT prompt_id, version, is_active FROM prompt_versions WHERE prompt_id IN ('ad_creative_generation', 'ad_elements_headlines', 'ad_elements_descriptions') ORDER BY prompt_id, version DESC;
