-- =====================================================
-- Migration: 106_sitelinks_count_6
-- Description: 更新广告创意生成Prompt - 要求生成6个Sitelinks(从之前的隐式4个改为明确6个)
-- Date: 2025-12-24
-- Database: SQLite
-- =====================================================

-- 背景：
-- 1. 目前Prompt中只在JSON输出格式提到sitelinks,但未明确数量
-- 2. brand-services-extractor.ts 之前限制为4个 → 已改为6个
-- 3. ad-creative-scorer.ts 之前建议4-6个 → 已改为6个
-- 4. 需要在Prompt中明确要求AI生成6个sitelinks

-- ========================================
-- ad_creative_generation: v4.17 → v4.17_p2
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_creative_generation' AND is_active = 1;

-- 幂等性：避免重复执行时 v4.17_p2 已存在导致唯一约束失败
DELETE FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.17_p2';

-- 2. 插入新版本 v4.17_p2 (Patch 2: 明确要求6个Sitelinks)
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
  'v4.17_p2',
  '广告创意生成',
  '广告创意生成v4.17_p2 - 明确要求6个Sitelinks',
  'Patch 2: 在Prompt中明确要求生成6个Sitelinks(之前只在JSON格式中隐式提及)',
  'src/lib/ad-creative-generator.ts',
  'buildAdCreativePrompt',
  '{{language_instruction}}

Generate Google Ads creative for {{brand}} ({{category}}).

{{link_type_section}}

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}
{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}

{{keywords_section}}

## 🆕 v4.16 关键词分层架构 (CRITICAL)

### 📊 关键词数据说明

{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

{{link_type_instructions}}

**⚠️ 重要：上述关键词已经过分层筛选，只包含以下两类：**

1. **品牌词（共享层）** - 所有创意都可以使用
   - 纯品牌词：{{brand}}, {{brand}} official, {{brand}} store
   - 品牌+品类词：{{brand}} camera, {{brand}} security

2. **桶匹配词（独占层）** - 只包含与当前桶主题匹配的关键词
   - 当前桶类型：{{bucket_type}}
   - 当前桶主题：{{bucket_intent}}

**✅ 这意味着：{{ai_keywords_section}}中的所有关键词都与{{bucket_intent}}主题兼容**

## 🔥 v4.10 关键词嵌入规则 (MANDATORY)

### ⚠️ 强制要求：8/15 (53%+) 标题必须包含关键词

**🔑 嵌入规则**:

**规则1: 关键词全部来自{{ai_keywords_section}}**
- 优先选择搜索量>1000的高价值关键词
- 品牌词必须出现在至少2个标题中
- 桶匹配词必须出现在至少6个标题中

**规则2: 嵌入方式 (自然融入，非堆砌)**
- ✅ 正确: "4K Security Camera Sale"
- ❌ 错误: "Camera Camera Security" (堆砌)

**规则3: 标题变体**
- 15个标题必须各不相同（避免重复）
- 每组5个标题使用不同的核心卖点和表达方式

## 🔥 v4.11 描述嵌入规则 (MANDATORY)

### ⚠️ 强制要求：5/5 (100%) 描述必须包含关键词

**规则1: 品牌词出现**
- **必须**在至少3个描述中包含品牌词 {{brand}}

**规则2: 行动号召 (Call-to-Action)**
- 每个描述**必须**包含明确的CTA
- CTA示例：Shop Now, Buy Today, Order Now, Get Yours, Explore Collection, Discover More

**规则3: 描述结构**
- 长度：90-150字符
- 必须包含：核心卖点 + 品牌词/关键词 + 明确CTA

## 🔥 v4.15 本地化规则 (CRITICAL)

**🔑 本地化规则**:

**规则1: 货币符号**
- 🇺🇸 US: USD ($)
- 🇬🇧 UK: GBP (£)
- 🇪🇺 EU: EUR (€)

**规则2: 紧急感本地化**
- 🇺🇸/🇬🇧: "Limited Time", "Today Only"
- 🇩🇪: "Nur heute", "Oferta limitada"
- 🇯🇵: "今だけ", "期間限定"

## 🆕 v4.16 店铺链接特殊规则

{{store_creative_instructions}}

## 🔧 v4.17_p2 Sitelinks要求 (2025-12-24)

### ⚠️ 强制要求：生成6个Sitelinks

**规则1: 数量固定**
- 必须生成**恰好6个**Sitelinks（不多不少）
- 每个Sitelink必须有text、url、description三个字段

**规则2: 长度限制**
- text: 最多25个字符
- description: 最多35个字符
- url: 统一使用 "/" (系统会自动替换为真实URL)

**规则3: 多样性要求**
- 6个Sitelinks必须覆盖不同的用户意图
- 避免重复或相似的链接文本
- 建议类型分布：
  * 产品页/分类页 (2个)
  * 促销/优惠页 (1-2个)
  * 关于品牌/服务页 (1个)
  * 保障/退换货页 (1个)

**示例**:
```json
"sitelinks": [
  {"text": "Shop All Products", "url": "/", "description": "Browse our full collection"},
  {"text": "Best Sellers", "url": "/", "description": "Top-rated items this month"},
  {"text": "Special Offers", "url": "/", "description": "Save up to 30% on select items"},
  {"text": "About Us", "url": "/", "description": "Learn about our brand story"},
  {"text": "Customer Reviews", "url": "/", "description": "4.8 stars from 10K+ customers"},
  {"text": "Free Shipping", "url": "/", "description": "On orders over $50"}
]
```

## 📋 OUTPUT (JSON only, no markdown):

{
  "headlines": [
    {"text": "...", "type": "brand|feature|promo|cta|urgency|social_proof|question|emotional", "length": N}
  ],
  "descriptions": [
    {"text": "...", "type": "feature-benefit-cta|problem-solution-proof|offer-urgency-trust|usp-differentiation", "length": N}
  ],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text": "...", "url": "/", "description": "..."}],
  "path1": "...",
  "path2": "...",
  "theme": "..."
}

**CRITICAL REQUIREMENTS**:
1. You MUST return ONLY valid JSON - no markdown formatting, no explanations, no German/other language text
2. All headlines and descriptions must be in the target language ({{target_language}})
3. All headlines must be ≤30 characters
4. All descriptions must be ≤90 characters
5. Return exactly 15 headlines and 4-5 descriptions
6. Return exactly 6 sitelinks (CRITICAL - 从之前的隐式改为明确要求)
7. If you cannot generate valid JSON, return an error message starting with "ERROR:".',
  'English',
  1,
  1,
  'v4.17_p2 Patch 2:
1. 在Prompt中明确要求生成6个Sitelinks
2. 添加"v4.17_p2 Sitelinks要求"专门章节，详细说明：
   - 数量固定：恰好6个
   - 长度限制：text≤25, desc≤35
   - 多样性要求：6种不同用户意图
   - 提供6个Sitelinks的示例
3. 在OUTPUT CRITICAL REQUIREMENTS中添加第6条：Return exactly 6 sitelinks
4. 同步修改配套代码：
   - brand-services-extractor.ts: slice(0, 4) → slice(0, 6)
   - ad-creative-scorer.ts: 建议4-6个 → 建议6个'
);

-- 验证结果
SELECT id, prompt_id, name, version, is_active
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY id DESC
LIMIT 5;

-- ✅ Migration complete!
