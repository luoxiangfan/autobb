-- Migration: 096_update_ad_creative_generation_v4.15
-- Description: 更新广告创意生成prompt v4.15，强化货币符号本地化、紧迫感生成、价格优势量化
-- Created: 2025-12-23
-- Version: v4.14 → v4.15
-- Prompts: 1个 (ad_creative_generation)
-- Database: SQLite
-- Author: Claude Code
-- Safety: 防重复执行 - 使用 INSERT OR IGNORE, 检查 is_active 状态

-- ========================================
-- ad_creative_generation: v4.14 → v4.15
-- ========================================

-- 0. 插入 v4.15 版本（使用 INSERT OR IGNORE 防止重复插入）
INSERT OR IGNORE INTO prompt_versions (
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
  'v4.15',
  '广告创意生成',
  '广告创意生成v4.15 - 货币/紧迫感/价格优化版',
  '强化货币符号本地化、紧迫感生成、价格优势量化要求',
  'src/lib/ad-creative-generator.ts',
  'buildAdCreativePrompt',
  '{{language_instruction}}

Generate Google Ads creative for {{brand}} ({{category}}).

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}
{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}

## 🆕 v4.10 关键词分层架构 (CRITICAL)

### 📊 关键词数据说明

{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

**⚠️ 重要：上述关键词已经过分层筛选，只包含以下两类：**

1. **品牌词（共享层）** - 所有创意都可以使用
   - 纯品牌词：{{brand}}, {{brand}} official, {{brand}} store
   - 品牌+品类词：{{brand}} camera, {{brand}} security

2. **桶匹配词（独占层）** - 只包含与当前桶主题匹配的关键词
   - 当前桶类型：{{bucket_type}}
   - 当前桶主题：{{bucket_intent}}

**✅ 这意味着：{{ai_keywords_section}}中的所有关键词都与{{bucket_intent}}主题兼容**
**✅ 关键词嵌入和主题一致性不会冲突**

## 🔥 v4.10 关键词嵌入规则 (MANDATORY)

### ⚠️ 强制要求：8/15 (53%+) 标题必须包含关键词

**🔑 嵌入规则**:

**规则1: 关键词全部来自{{ai_keywords_section}}**
- 这些关键词已经是"品牌词 + 桶匹配词"的组合
- 优先选择搜索量>1000的高价值关键词
- 品牌词必须出现在至少2个标题中
- 桶匹配词必须出现在至少6个标题中

**规则2: 嵌入方式 (自然融入，非堆砌)**
- ✅ 正确: "4K Security Camera Sale" (关键词: security camera)
- ✅ 正确: "Solar Powered Cameras" (关键词: solar camera)
- ❌ 错误: "Camera Camera Security" (关键词堆砌)
- ❌ 错误: "Best Quality Product" (无关键词)

**规则3: 嵌入与主题双重验证**
- 每个嵌入的关键词必须同时满足：
  - ✅ 来自{{ai_keywords_section}}
  - ✅ 符合{{bucket_intent}}主题
- 由于关键词已预筛选，两个条件天然兼容

## 🎯 v4.10 主题一致性要求

{{bucket_info_section}}

### 主题约束规则

**桶A（品牌导向）文案风格**:
- Headlines: 突出品牌实力、官方正品、品牌优势
- Descriptions: 强调品牌价值、官方保障、品牌故事
- ✅ 示例: "Official Eufy Store | Trusted Brand Quality"

**桶B（场景导向）文案风格**:
- Headlines: 突出应用场景、解决方案、使用环境
- Descriptions: 描述使用场景、用户收益、痛点解决
- ✅ 示例: "Protect Your Home 24/7 | Eufy Smart Security"

**桶C（功能导向）文案风格**:
- Headlines: 突出核心功能、技术优势、性能参数
- Descriptions: 强调差异化功能、技术参数、用户评价
- ✅ 示例: "4K Ultra HD Night Vision | Eufy Camera"

### 主题一致性检查清单

- [ ] 100% Headlines体现{{bucket_intent}}主题
- [ ] 100% Descriptions体现{{bucket_intent}}主题
- [ ] 100% 嵌入的关键词来自{{ai_keywords_section}}（已预筛选）
- [ ] 53%+ Headlines包含关键词

## 🔥 v4.15 关键优化 (CRITICAL)

### 💰 1. 货币符号本地化 (P0 CRITICAL)

**{{localization_section}}**

**🔴 强制要求**：所有价格必须使用正确的本地货币符号！
- ✅ UK (GBP): "Save £170", "Only £499", "Was £669 Now £499"
- ✅ US (USD): "Save $170", "Only $499", "Was $669 Now $499"
- ✅ EU (EUR): "Save €170", "Only €499", "Was €669 Now €499"
- ❌ 禁止: UK市场使用"$"或"€"，必须用"£"

### ⏰ 2. 紧迫感表达 (P1 CRITICAL)

**所有广告创意必须包含紧迫感元素！**
- **至少 2-3 个 headlines 必须包含紧迫感表达**
- 紧迫感类型：
  - **即时行动**: "Order Now", "Shop Today", "Get Yours Now"
  - **时间紧迫**: "Limited Time", "Ends Soon", "Today Only", "Offer Ends Tonight"
  - **稀缺信号**: "Limited Stock", "Almost Gone", "Few Left", "Selling Fast"
  - **FOMO**: "Don''t Miss Out", "Last Chance", "Act Fast"

**✅ 正确示例**:
- "Reolink NVR Kit: Save £170 - Order Now"
- "8 Camera 4K System - Limited Time Offer"
- "Reolink Security: Don''t Miss Out - Save £170"
- "4K CCTV System - Only 5 Left in Stock"

**❌ 禁止**: "Limited Stock", "Limited Time", "Limited Offer" (这些太相似)

### 💵 3. 价格优势量化 (P0 CRITICAL)

**所有促销类 headlines 必须使用具体金额，不能只用百分比！**

**✅ GOOD (具体金额)**:
- "Save £170 Today"
- "Was £669, Now £499 - Save £170"
- "Reolink NVR Kit: Only £499 - Save £170"
- "Best Value: £499 vs £669 Elsewhere"

**❌ BAD (只有百分比)**:
- "20% Off"
- "Save 20%"
- "Discount Applied"
- "Great Deal"

**🎯 强制要求**:
- 至少 2 个 headlines 必须使用具体节省金额
- 使用价格锚点: "Was X, Now Y" 或 "Save X"
- 如果只有百分比折扣，必须估算金额: "Save 20% - £170 Off"

## v4.7 RSA Display Path (继承)

**path1 (必填，最多15字符)**: 核心产品类别或品牌关键词
**path2 (可选，最多15字符)**: 产品特性、型号或促销信息

## REQUIREMENTS (Target: EXCELLENT Ad Strength)

### HEADLINES (15 required, ≤30 chars each)
**FIRST HEADLINE (MANDATORY)**: "{KeyWord:{{brand}}} Official" - If exceeds 30 chars, use "{KeyWord:{{brand}}}"
**⚠️ CRITICAL**: ONLY the first headline can use {KeyWord:...} format.

**🚨 v4.10 HEADLINE REQUIREMENTS**:
- 🔥 **Keyword Embedding**: 8/15 (53%+) headlines MUST contain keywords from {{ai_keywords_section}}
- 🔥 **Theme Consistency**: 100% headlines MUST match {{bucket_intent}} theme
- 🔥 **Emotional Triggers**: 3+ headlines with emotional power words
- 🔥 **Question Headlines**: 1-2 question-style headlines
- 🔥 **Number Usage**: 5+ headlines with specific numbers
- 🔥 **Diversity**: <20% text similarity, no 2+ shared words (excluding embedded keywords from {{ai_keywords_section}})
- 🔥 **Urgency**: 2-3 headlines MUST include urgency elements (see v4.15 section above)
- 🔥 **Price Quantification**: Promo headlines MUST use specific amounts, NOT just percentages (see v4.15 section above)

### DESCRIPTIONS (4 required, ≤90 chars each)

**🎯 v4.10 DESCRIPTION REQUIREMENTS**:
- 🔥 **Theme Consistency**: 100% descriptions MUST match {{bucket_intent}} theme
- 🔥 **Keyword Integration**: Include 1-2 keywords from {{ai_keywords_section}} per description
- 🔥 **USP Front-Loading**: Strongest USP in first 30 characters
- 🔥 **Social Proof**: 2/4 descriptions must include proof element
- 🔥 **Urgency**: At least 1 description MUST include urgency element
- 🔥 **Price Clarity**: If discussing deals, use specific currency symbols and amounts

### KEYWORDS (输出{{ai_keywords_section}}中的全部关键词)
**⚠️ 直接输出{{ai_keywords_section}}中的所有关键词，不要生成新关键词**
**⚠️ 所有关键词必须使用目标语言 {{target_language}}**

{{exclude_keywords_section}}

### CALLOUTS (4-6, ≤25 chars)
{{callout_guidance}}

### SITELINKS (6): text≤25, desc≤35, url="/"

## FORBIDDEN CONTENT:
**❌ Prohibited Words**: "100%", "best", "guarantee", "miracle", ALL CA abuse
**❌ Prohibited Symbols**: ★ ☆ ⭐ 🌟 ✨ © ® ™ • ● ◆ ▪ → ← ↑ ↓ ✓ ✔ ✗ ✘ ❤ ♥ ⚡ 🔥 💎 👍 👎
**❌ Excessive Punctuation**: "!!!", "???", "..."

## OUTPUT (JSON only, no markdown):
{
  "headlines": [{"text":"...", "type":"brand|feature|promo|cta|urgency|social_proof|question|emotional", "length":N, "keywords":["keyword1"], "hasNumber":bool, "hasUrgency":bool, "hasEmotionalTrigger":bool, "isQuestion":bool, "themeMatch":true}...],
  "descriptions": [{"text":"...", "type":"feature-benefit-cta|problem-solution-proof|offer-urgency-trust|usp-differentiation", "length":N, "hasCTA":bool, "first30Chars":"...", "hasSocialProof":bool, "keywords":["keyword1"], "themeMatch":true}...],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text":"...", "url":"/", "description":"..."}],
  "path1": "...",
  "path2": "...",
  "theme": "...",
  "bucket_type": "{{bucket_type}}",
  "bucket_intent": "{{bucket_intent}}",
  "keyword_layer_validation": {
    "brand_keywords_used": ["brand1", "brand2"],
    "bucket_keywords_used": ["kw1", "kw2", "kw3"],
    "total_keywords_embedded": 8,
    "embedding_rate": 0.53
  },
  "theme_consistency": {
    "headline_match_rate": 1.0,
    "description_match_rate": 1.0,
    "overall_score": 1.0
  },
  "quality_metrics": {"headline_diversity_score":N, "keyword_embedding_rate":0.53, "emotional_trigger_count":N, "question_headline_count":N, "usp_front_loaded_count":N, "urgency_headline_count":2, "estimated_ad_strength":"EXCELLENT"}
}',
  'English',
  1,
  0,
  'v4.15 更新内容:
1. 新增货币符号本地化要求 (P0 CRITICAL)
2. 新增紧迫感表达要求 (P1 CRITICAL)
3. 新增价格优势量化要求 (P0 CRITICAL)
4. 更新OUTPUT结构添加urgency_headline_count字段'
);

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_creative_generation' AND is_active = 1;

-- 2. 将 v4.15 设为活跃版本（如果需要回滚到v4.15）
-- 注意：通常我们直接使用v4.16，这个仅用于v4.15的独立场景
-- UPDATE prompt_versions
-- SET is_active = 1
-- WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.15';

-- 验证结果
SELECT id, prompt_id, name, version, is_active
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY version DESC
LIMIT 3;
