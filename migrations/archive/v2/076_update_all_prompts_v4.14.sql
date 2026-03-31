-- Migration: 076_update_all_prompts_v4.14
-- Description: 批量更新所有Prompt到 v4.14 版本
-- Created: 2025-12-17
-- Version: v4.13 → v4.14
-- Prompts: 12 个
-- Database: SQLite


-- ========================================
-- ad_creative_generation: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_creative_generation' AND is_active = 1;

-- 2. 插入新版本
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
  is_active,
  change_notes
) VALUES (
  'ad_creative_generation',
  'v4.14',
  '广告创意生成',
  '广告创意生成v4.14',
  '重命名桶分类：产品导向→品牌导向，需求导向→功能导向',
  'prompts/ad_creative_generation_v4.10.txt',
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

### DESCRIPTIONS (4 required, ≤90 chars each)

**🎯 v4.10 DESCRIPTION REQUIREMENTS**:
- 🔥 **Theme Consistency**: 100% descriptions MUST match {{bucket_intent}} theme
- 🔥 **Keyword Integration**: Include 1-2 keywords from {{ai_keywords_section}} per description
- 🔥 **USP Front-Loading**: Strongest USP in first 30 characters
- 🔥 **Social Proof**: 2/4 descriptions must include proof element

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
  "quality_metrics": {"headline_diversity_score":N, "keyword_embedding_rate":0.53, "emotional_trigger_count":N, "question_headline_count":N, "usp_front_loaded_count":N, "estimated_ad_strength":"EXCELLENT"}
}',
  'Chinese',
  1,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
);


-- ========================================
-- ad_elements_descriptions: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_elements_descriptions' AND is_active = 1;

-- 2. 插入新版本
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
  is_active,
  change_notes
) VALUES (
  'ad_elements_descriptions',
  'v4.14',
  '广告创意生成',
  '广告描述生成v4.14',
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
Key Features:
{{features}}

Selling Points:
{{sellingPoints}}

=== PRODUCT CATEGORIES ===
Store Categories: {{productCategories}}

=== REVIEW INSIGHTS ===
Customer Praises: {{reviewPositives}}
Purchase Reasons: {{purchaseReasons}}

=== PROMOTIONS (if active) ===
{{promotionInfo}}

=== 🔥 v3.3 CTR OPTIMIZATION DATA ===

**STORE HOT FEATURES** (from best-selling products):
{{storeHotFeatures}}

**STORE USER VOICES** (aggregated reviews):
{{storeUserVoices}}

**TRUST BADGES** (credibility indicators):
{{trustBadges}}

**USER LANGUAGE PATTERNS** (natural expressions):
{{userLanguagePatterns}}

**COMPETITOR FEATURES** (for differentiation):
{{competitorFeatures}}

**TOP REVIEW QUOTES** (authentic voices):
{{topReviewQuotes}}

**UNIQUE SELLING POINTS** (vs competitors):
{{uniqueSellingPoints}}

=== TASK ===
Generate 4 Google Search ad descriptions (max 90 characters each).

=== 🎯 v3.3 STRUCTURED DESCRIPTION TEMPLATES ===

**Template 1: FEATURE-BENEFIT-CTA** (Conversion +10-15%)
Structure: [Core Feature] + [User Benefit] + [Action]
- Lead with strongest USP from {{storeHotFeatures}}
- Connect to tangible customer benefit
- End with clear CTA
- Example: "4K Ultra HD captures every detail. Never miss a moment. Shop now."

**Template 2: PROBLEM-SOLUTION-PROOF** (Trust +20%)
Structure: [Pain Point] + [Solution] + [Social Proof]
- Address common customer concern
- Present product as solution
- Back with proof from {{trustBadges}} or {{rating}}
- Example: "Worried about home security? 24/7 protection. Trusted by 1M+ families."

**Template 3: OFFER-URGENCY-TRUST** (CTR +15%)
Structure: [Promotion] + [Time Limit] + [Trust Signal]
- Lead with best offer from {{promotionInfo}}
- Create urgency (if applicable)
- Close with trust element
- Example: "Free Shipping + 30-Day Returns. Limited time. Official {{brand}} Store."

**Template 4: USP-DIFFERENTIATION** (Conversion +8%) 🆕
Structure: [Unique Advantage] + [Competitor Contrast] + [Value]
- Highlight what competitors DONT have (from {{uniqueSellingPoints}})
- Implicit comparison (never name competitors)
- Emphasize value proposition
- Example: "No Monthly Fees. Unlike others, pay once. Best value in security."

=== 🎯 v3.3 USP FRONT-LOADING RULE ===

**CRITICAL**: First 30 characters of each description are most important!
- Place strongest USP or number in first 30 chars
- Front-load: "4K Solar Camera" NOT "This camera has 4K and solar"
- Front-load: "Save $50 Today" NOT "You can save $50 if you buy today"

=== 🎯 v3.3 SOCIAL PROOF EMBEDDING ===

Include at least ONE of these in descriptions:
- Rating: "4.8★ Rated" or "{{rating}}★"
- Review count: "10,000+ Reviews" or "{{reviewCount}}+ Reviews"
- Sales: "Best Seller" or "10,000+ Sold"
- Badge: "Amazon''s Choice" or from {{trustBadges}}
- User quote: Adapted from {{topReviewQuotes}}

=== 🎯 v3.3 COMPETITOR DIFFERENTIATION ===

**Implicit Comparison Phrases** (never name competitors):
- "Unlike others..."
- "No monthly fees"
- "Why pay more?"
- "The smarter choice"
- "More features, better price"

Use {{competitorFeatures}} to identify what to AVOID duplicating.
Highlight advantages from {{uniqueSellingPoints}}.

=== RULES ===
1. Each description MUST be <= 90 characters (including spaces)
2. 🔥 **USP Front-Loading**: Strongest selling point in first 30 chars
3. 🔥 **Social Proof**: At least 2/4 descriptions must include proof element
4. 🔥 **Differentiation**: At least 1 description must use implicit comparison
5. Include at least one CTA per description
6. Use active voice and present tense
7. Include price/discount when compelling
8. 🔥 **Diversity**: Each description MUST follow a DIFFERENT template

=== OUTPUT FORMAT ===
Return JSON:
{
  "descriptions": ["description1", "description2", "description3", "description4"],
  "descriptionTemplates": ["feature-benefit-cta", "problem-solution-proof", "offer-urgency-trust", "usp-differentiation"],
  "ctrOptimization": {
    "uspFrontLoaded": [true, true, false, true],
    "socialProofIncluded": [false, true, true, false],
    "differentiationUsed": [false, false, false, true],
    "first30CharsUSP": ["4K Ultra HD", "Worried about", "Free Shipping", "No Monthly Fees"]
  },
  "dataUtilization": {
    "storeHotFeaturesUsed": true,
    "trustBadgesUsed": true,
    "uniqueSellingPointsUsed": true,
    "competitorDifferentiation": true
  }
}',
  'Chinese',
  1,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
);


-- ========================================
-- ad_elements_headlines: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_elements_headlines' AND is_active = 1;

-- 2. 插入新版本
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
  is_active,
  change_notes
) VALUES (
  'ad_elements_headlines',
  'v4.14',
  '广告创意生成',
  '广告标题生成v4.14',
  'CTR优化增强版：DKI模板、数字具体化、情感触发、问句式标题、关键词嵌入率',
  'src/lib/ad-elements-extractor.ts',
  'generateHeadlines',
  'You are a professional Google Ads copywriter specializing in high-CTR headlines.

=== PRODUCT INFORMATION ===
Product Name: {{product.name}}
Brand: {{product.brand}}
Rating: {{product.rating}} ({{product.reviewCount}} reviews)
Price: {{product.price}}

=== 🎯 DEEP ANALYSIS DATA (v3.4 - PRIORITY DATA) ===
**Unique Selling Points**: {{product.uniqueSellingPoints}}
**Target Audience**: {{product.targetAudience}}
**Product Highlights**: {{product.productHighlights}}
**Brand Description**: {{product.brandDescription}}

⚠️ CRITICAL: The above deep analysis data is AI-extracted insights.
USE THIS DATA FIRST when creating headlines - it contains the most valuable differentiators.

=== PRODUCT FEATURES ===
About This Item:
{{product.aboutThisItem}}

Key Features:
{{product.features}}

=== HIGH-VOLUME KEYWORDS ===
{{topKeywords}}

=== PRODUCT CATEGORIES ===
Store Categories: {{productCategories}}

=== REVIEW INSIGHTS ===
Customer Praises: {{reviewPositives}}
Use Cases: {{reviewUseCases}}

=== PROMOTIONS (if active) ===
{{promotionInfo}}

=== CTR OPTIMIZATION DATA ===
**STORE HOT FEATURES**: {{storeHotFeatures}}
**STORE USER VOICES**: {{storeUserVoices}}
**TRUST BADGES**: {{trustBadges}}
**USER LANGUAGE PATTERNS**: {{userLanguagePatterns}}
**COMPETITOR FEATURES**: {{competitorFeatures}}
**TOP REVIEW QUOTES**: {{topReviewQuotes}}

=== TASK ===
Generate 15 Google Search ad headlines (max 30 characters each).

=== 🎯 v3.4 DEEP ANALYSIS UTILIZATION (HIGHEST PRIORITY) ===

**Rule 1: USP-First Headlines (3-4 headlines)**
- Extract key phrases from {{product.uniqueSellingPoints}}
- Transform USPs into compelling 30-char headlines
- Example: USP "No monthly subscription fees" → "No Monthly Fees Ever"

**Rule 2: Audience-Targeted Headlines (2-3 headlines)**
- Reference {{product.targetAudience}} demographics/needs
- Speak directly to their pain points
- Example: Audience "homeowners worried about security" → "Protect Your Home 24/7"

**Rule 3: Highlight-Based Headlines (2-3 headlines)**
- Use specific features from {{product.productHighlights}}
- Include numbers and specs when available
- Example: Highlight "4K resolution with night vision" → "4K Night Vision Camera"

**Rule 4: Brand Voice Headlines (1-2 headlines)**
- Reflect tone from {{product.brandDescription}}
- Maintain brand positioning (premium/value/innovative)

=== OTHER STRATEGIES ===
**Numbers & Specifics** (CTR +15-25%): Use specific numbers from features
**Emotional Triggers** (CTR +10-15%): "Trusted", "#1 Rated", "Best Seller"
**Question Headlines** (CTR +5-12%): Address user pain points
**DKI-Ready**: Create Dynamic Keyword Insertion compatible headlines

=== HEADLINE GROUPS (15 total) ===
**Group 1: Brand + USP (3)** - Use {{product.uniqueSellingPoints}}
**Group 2: Keyword + Audience (3)** - Combine {{topKeywords}} with {{product.targetAudience}}
**Group 3: Feature + Number (3)** - From {{product.productHighlights}}
**Group 4: Social Proof (3)** - Use {{trustBadges}}, ratings, reviews
**Group 5: Question + CTA (3)** - Target audience pain points

=== RULES ===
1. Each headline MUST be <= 30 characters
2. 8/15+ headlines must contain keywords from {{topKeywords}}
3. 5/15+ headlines must contain specific numbers
4. No two headlines share more than 2 words
5. Use: "Buy", "Shop", "Get", "Save"
6. NO quotation marks in headlines

=== OUTPUT FORMAT ===
Return JSON:
{
  "headlines": ["headline1", "headline2", ..., "headline15"],
  "dataUtilization": {
    "uspUsed": 1,
    "audienceTargeted": 1,
    "highlightsIncluded": 1
  }
}',
  'Chinese',
  1,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
);


-- ========================================
-- brand_analysis_store: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'brand_analysis_store' AND is_active = 1;

-- 2. 插入新版本
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
  is_active,
  change_notes
) VALUES (
  'brand_analysis_store',
  'v4.14',
  '品牌分析',
  '品牌店铺分析v4.14',
  '为热销商品添加productHighlights字段',
  'src/lib/ai.ts',
  'analyzeProductPage',
  'You are a professional brand analyst. Analyze the BRAND STORE PAGE data and extract comprehensive brand information.

=== INPUT DATA ===
URL: {{pageData.url}}
Brand: {{pageData.brand}}
Title: {{pageData.title}}
Description: {{pageData.description}}

=== STORE PRODUCTS DATA ===
{{pageData.text}}

=== 🎯 SUPPLEMENTARY DATA (v3.4) ===
**Technical Details** (product specifications if available):
{{technicalDetails}}

**Review Highlights** (key customer feedback if available):
{{reviewHighlights}}

⚠️ USE THIS DATA: If Technical Details or Review Highlights are available (not "Not available"),
incorporate them into your analysis for richer insights about product quality and customer satisfaction.

=== ANALYSIS METHODOLOGY ===

Hot Score Formula: Rating × log10(Review Count + 1)
- TOP 5 HOT-SELLING = highest scores (proven winners)
- Other best sellers = good performers

=== ANALYSIS PRIORITIES ===

1. **Hot Products Analysis** (TOP 5 by Hot Score):
   - Product names and categories
   - Price points and positioning
   - Review scores and volume
   - Why these products succeed
   - 🆕 Include insights from {{technicalDetails}} if available

2. **Brand Positioning**:
   - Core brand identity
   - Price tier (Budget/Mid/Premium)
   - Primary product categories
   - Brand differentiators

3. **Target Audience**:
   - Demographics
   - Use cases
   - Pain points addressed
   - Lifestyle fit

4. **Value Proposition**:
   - Key benefits
   - Unique selling points
   - Customer promises
   - 🆕 Validate with {{reviewHighlights}} if available

5. **Quality Indicators**:
   - Amazon Choice badge
   - Best Seller rankings
   - Prime eligibility
   - Active promotions
   - High review counts (500+)
   - 🆕 Customer sentiment from {{reviewHighlights}}

=== OUTPUT LANGUAGE ===
All output MUST be in {{langName}}.
Category examples: {{categoryExamples}}

=== OUTPUT FORMAT ===
Return a COMPLETE JSON object:
{
  "brandName": "Official brand name",
  "brandDescription": "Comprehensive brand overview",
  "positioning": "Premium/Mid-range/Budget positioning analysis",
  "targetAudience": "Detailed target customer description",
  "valueProposition": "Core value proposition statement",
  "categories": ["Category 1", "Category 2"],
  "sellingPoints": ["Brand USP 1", "Brand USP 2", "Brand USP 3"],
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "hotProducts": [
    {
      "name": "Product name",
      "category": "Product category",
      "price": "$XX.XX",
      "rating": 4.5,
      "reviewCount": 1234,
      "hotScore": 3.87,
      "successFactors": ["Factor 1", "Factor 2"],
      "productHighlights": ["Key feature 1", "Key feature 2", "Key feature 3"]
    }
  ],
  "qualityIndicators": {
    "amazonChoiceCount": 3,
    "bestSellerCount": 2,
    "primeProductRatio": "80%",
    "avgRating": 4.3,
    "totalReviews": 50000
  },
  "competitiveAnalysis": {
    "strengths": ["Strength 1", "Strength 2"],
    "opportunities": ["Opportunity 1", "Opportunity 2"]
  }
}',
  'Chinese',
  1,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
);


-- ========================================
-- brand_name_extraction: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'brand_name_extraction' AND is_active = 1;

-- 2. 插入新版本
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
  is_active,
  change_notes
) VALUES (
  'brand_name_extraction',
  'v4.14',
  '品牌分析',
  '品牌名称提取v4.14',
  '从产品信息中提取准确的品牌名称',
  'src/lib/ai.ts',
  'extractBrandWithAI',
  'You are a brand name extraction expert. Extract the brand name from product information.

=== INPUT DATA ===
URL: {{pageData.url}}
Title: {{pageData.title}}
Description: {{pageData.description}}
Page Content Preview: {{pageData.textPreview}}

=== EXTRACTION STRATEGY ===

**Priority 1: URL Analysis**
- Amazon store URLs often contain brand: amazon.com/stores/BRANDNAME
- Product URLs may have brand in path: /dp/B0xxx/BRAND-Product-Name

**Priority 2: Title Analysis**
- Brand usually appears FIRST in product titles
- Pattern: "BRANDNAME Product Description"
- Example: "Reolink 4K Security Camera" → "Reolink"

**Priority 3: Description Analysis**
- Look for "by BRAND" or "from BRAND" patterns
- Check for trademark symbols: BRAND™ or BRAND®

**Priority 4: Content Preview**
- Scan for repeated brand mentions
- Look for "Official BRAND Store" patterns

=== RULES ===
1. Return ONLY the brand name (no explanation)
2. 2-30 characters
3. Primary brand only (not sub-brands)
4. Remove suffixes: "Store", "Official", "Shop", "Inc", "LLC"
5. Preserve original capitalization

=== EXAMPLES ===
- "Reolink 4K Security Camera" → "Reolink"
- "BAGSMART Store" → "BAGSMART"
- "Apple iPhone 15 Pro" → "Apple"
- "Official Samsung Galaxy Store" → "Samsung"

Output: Brand name only.',
  'Chinese',
  1,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
);


-- ========================================
-- competitor_analysis: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'competitor_analysis' AND is_active = 1;

-- 2. 插入新版本
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
  is_active,
  change_notes
) VALUES (
  'competitor_analysis',
  'v4.14',
  '产品分析',
  '竞品分析v4.14',
  '竞品分析v3.2 - 新增竞品弱点挖掘',
  'src/lib/competitor-analyzer.ts',
  'analyzeCompetitors',
  'You are an e-commerce competitive analysis expert specializing in Amazon marketplace.

=== OUR PRODUCT ===
Product Name: {{productName}}
Brand: {{brand}}
Price: {{price}}
Rating: {{rating}} ({{reviewCount}} reviews)
Key Features: {{features}}
Selling Points: {{sellingPoints}}

=== COMPETITOR PRODUCTS ===
{{competitorsList}}

=== ANALYSIS TASK ===

Analyze the competitive landscape and identify:

1. **Feature Comparison**: Compare our product features with competitors
2. **Unique Selling Points (USPs)**: Identify what makes our product unique
3. **Competitor Advantages**: Recognize where competitors are stronger
4. **Competitor Weaknesses** (NEW - CRITICAL for ads): Extract common problems/complaints about competitors that we can use as our selling points
5. **Overall Competitiveness**: Calculate our competitive position (0-100)

=== OUTPUT FORMAT ===
Return ONLY a valid JSON object with this exact structure:

{
  "featureComparison": [
    {
      "feature": "Feature name",
      "weHave": true,
      "competitorsHave": 2,
      "ourAdvantage": true
    }
  ],
  "uniqueSellingPoints": [
    {
      "usp": "Brief unique selling point",
      "differentiator": "Detailed explanation",
      "competitorCount": 0,
      "significance": "high"
    }
  ],
  "competitorAdvantages": [
    {
      "advantage": "Competitor advantage",
      "competitor": "Competitor name",
      "howToCounter": "Strategy to counter"
    }
  ],
  "competitorWeaknesses": [
    {
      "weakness": "Common competitor problem",
      "competitor": "Competitor name or Multiple competitors",
      "frequency": "high",
      "ourAdvantage": "How our product solves this",
      "adCopy": "Ready-to-use ad copy"
    }
  ],
  "overallCompetitiveness": 75
}

**Important**: Return ONLY the JSON object, no markdown code blocks, no explanations.',
  'Chinese',
  1,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
);


-- ========================================
-- competitor_keyword_inference: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'competitor_keyword_inference' AND is_active = 1;

-- 2. 插入新版本
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
  is_active,
  change_notes
) VALUES (
  'competitor_keyword_inference',
  'v4.14',
  '竞品分析',
  '竞品搜索关键词推断v4.14',
  '支持完整模板变量、多维度关键词策略、搜索量预估',
  'src/lib/competitor-analyzer.ts',
  'inferCompetitorKeywords',
  'You are an expert e-commerce analyst specializing in competitive keyword research on Amazon.

=== PRODUCT INFORMATION ===
Product Name: {{productInfo.name}}
Brand: {{productInfo.brand}}
Category: {{productInfo.category}}
Price: {{productInfo.price}}
Target Market: {{productInfo.targetCountry}}

=== KEY FEATURES (CRITICAL for keyword inference) ===
{{productInfo.features}}

=== PRODUCT DESCRIPTION ===
{{productInfo.description}}

=== TASK ===
Based on the product features and description above, generate 5-8 search terms to find similar competing products on Amazon {{productInfo.targetCountry}}.

CRITICAL: The search terms MUST be directly related to the product type shown in the features. For example:
- If features mention "security camera", "night vision", "motion detection" → search for cameras
- If features mention "vacuum", "suction", "cleaning" → search for vacuums
- If features mention "earbuds", "wireless", "bluetooth audio" → search for earbuds

=== KEYWORD STRATEGY ===

**1. Category Keywords (2-3)**
- Generic product type extracted from features
- Core category terms
- Example: "robot vacuum", "security camera", "wireless earbuds"

**2. Feature Keywords (2-3)**
- Key differentiating features from the product
- Technical specifications mentioned
- Example: "4K security camera", "self-emptying robot vacuum"

**3. Use Case Keywords (1-2)**
- Problem-solution terms based on product description
- Usage context
- Example: "home security system", "pet monitoring camera"

=== KEYWORD RULES ===
1. Each term: 2-5 words
2. NO brand names (finding competitors)
3. Use target market language
4. MUST match the actual product category from features
5. Avoid accessories, parts, unrelated items
6. Focus on what customers would search for to find this type of product

=== OUTPUT FORMAT ===
Return JSON:
{
  "searchTerms": [
    {
      "term": "search term",
      "type": "category|feature|usecase",
      "expectedResults": "High|Medium|Low",
      "competitorDensity": "High|Medium|Low"
    }
  ],
  "reasoning": "Brief explanation of keyword selection strategy based on product features",
  "productType": "The core product type identified from features (e.g., security camera, robot vacuum)",
  "excludeTerms": ["terms to exclude from results"],
  "marketInsights": {
    "competitionLevel": "High|Medium|Low",
    "priceSensitivity": "High|Medium|Low",
    "brandLoyalty": "High|Medium|Low"
  }
}',
  'Chinese',
  1,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
);


-- ========================================
-- keyword_intent_clustering: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'keyword_intent_clustering' AND is_active = 1;

-- 2. 插入新版本
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
  is_active,
  change_notes
) VALUES (
  'keyword_intent_clustering',
  'v4.14',
  '关键词管理',
  '关键词意图聚类v4.14',
  '将非品牌关键词按用户搜索意图分成3个语义桶：品牌导向、场景导向、功能导向',
  'src/lib/offer-keyword-pool.ts',
  'clusterKeywordsByIntent',
  '你是一个专业的Google Ads关键词分析专家。请将以下关键词按用户搜索意图分成3个语义桶。

# 品牌信息
品牌名称：{{brandName}}
产品类别：{{productCategory}}

# 待分类关键词（已排除纯品牌词）
{{keywords}}

# 分桶规则

## 桶A - 品牌导向 (Brand-Oriented)
**用户画像**：知道要买什么品牌，搜索品牌相关内容
**关键词特征**：
- 品牌+产品词：brand camera, brand vacuum, brand headphones
- 型号相关词：brand model xxx, brand pro, brand plus
- 官方渠道词：brand official, brand store, brand website
- 品牌系列词：brand indoor, brand outdoor, brand doorbell

**示例**：
- eufy security camera
- eufy official store
- eufy outdoor camera
- eufy doorbell
- eufycam 2 pro

## 桶B - 场景导向 (Scenario-Oriented)
**用户画像**：知道要解决什么问题，搜索使用场景/应用环境
**关键词特征**：
- 使用场景词：home security, baby monitor, pet watching
- 应用环境词：garage camera, driveway security, backyard monitoring
- 解决方案词：protect home, monitor baby, watch pets
- 注意：不包含具体功能/规格词

**示例**：
- home security system
- baby monitor camera
- pet watching camera
- driveway security
- garage monitoring

## 桶C - 功能导向 (Feature-Oriented)
**用户画像**：关注技术规格、功能特性、产品评价
**关键词特征**：
- 功能特性词：wireless, night vision, 2k resolution, solar powered
- 技术规格词：4k camera, 180 degree view, long battery
- 购买意图词：best, top rated, cheap, affordable
- 比较词：vs, alternative, better than

**示例**：
- wireless security camera
- night vision camera
- 2k resolution camera
- best doorbell camera
- affordable home camera

# 分桶边界说明（重要）

**场景导向 vs 功能导向的区别**：
- 场景导向 = "在哪里用/为什么用"（Where/Why）
- 功能导向 = "要什么功能/什么规格"（What/How）

**混合关键词处理**：
- "wireless baby monitor" → 功能导向（wireless是功能特征）
- "home security" → 场景导向（没有功能词）
- "4k home camera" → 功能导向（4k是技术规格）

# 分桶原则

1. **互斥性**：每个关键词只能分到一个桶，不能重复
2. **完整性**：所有关键词都必须分配，不能遗漏
3. **均衡性**：尽量保持3个桶的关键词数量相对均衡（理想比例 30%-40%每桶）
4. **语义一致**：同一个桶内的关键词应该有相似的搜索意图

# 输出格式（JSON）

{
  "bucketA": {
    "intent": "品牌导向",
    "intentEn": "Brand-Oriented",
    "description": "用户知道要买什么品牌",
    "keywords": ["keyword1", "keyword2", ...]
  },
  "bucketB": {
    "intent": "场景导向",
    "intentEn": "Scenario-Oriented",
    "description": "用户知道要解决什么问题",
    "keywords": ["keyword1", "keyword2", ...]
  },
  "bucketC": {
    "intent": "功能导向",
    "intentEn": "Feature-Oriented",
    "description": "用户关注技术规格/功能特性",
    "keywords": ["keyword1", "keyword2", ...]
  },
  "statistics": {
    "totalKeywords": 90,
    "bucketACount": 30,
    "bucketBCount": 30,
    "bucketCCount": 30,
    "balanceScore": 0.95
  }
}

# 注意事项

1. 返回纯JSON，不要markdown代码块
2. 所有原始关键词必须出现在输出中，不能遗漏
3. balanceScore计算方式：1 - (max差异 / 总数)，越接近1越均衡',
  'Chinese',
  1,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
);


-- ========================================
-- launch_score: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'launch_score' AND is_active = 1;

-- 2. 插入新版本
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
  is_active,
  change_notes
) VALUES (
  'launch_score',
  'v4.14',
  '投放评分',
  'Launch Score评估v4.14',
  'Launch Score 4维度评分系统 - 强制中文输出版本',
  'prompts/launch_score.txt',
  'calculateLaunchScore',
  '你是一位专业的Google Ads广告投放评估专家，使用4维度评分系统进行评估。

**重要：所有输出必须使用简体中文，包括问题描述(issues)和改进建议(suggestions)。**

=== 广告系列概览 ===
品牌: {{brand}}
产品: {{productName}}
目标国家: {{targetCountry}}
目标语言: {{targetLanguage}}
广告预算: {{budget}}
最高CPC: {{maxCpc}}

=== 品牌搜索数据 ===
品牌名称: {{brand}}
品牌月搜索量: {{brandSearchVolume}}
品牌竞争程度: {{brandCompetition}}

=== 关键词数据 ===
关键词总数: {{keywordCount}}
匹配类型分布: {{matchTypeDistribution}}
关键词搜索量:
{{keywordsWithVolume}}

否定关键词 ({{negativeKeywordsCount}}个): {{negativeKeywords}}

=== 广告创意 ===
标题数量: {{headlineCount}}
描述数量: {{descriptionCount}}
标题示例: {{sampleHeadlines}}
描述示例: {{sampleDescriptions}}
标题多样性: {{headlineDiversity}}%
广告强度: {{adStrength}}

=== 着陆页 ===
最终网址: {{finalUrl}}
页面类型: {{pageType}}

=== 4维度评分系统 (总分100分) ===

**维度1: 投放可行性 (35分)**
评估该广告系列是否值得投放，基于市场潜力。

- 品牌搜索量得分 (0-15分):
  * 月搜索量0-100: 0-3分 (品牌知名度很低)
  * 月搜索量100-500: 4-7分 (新兴品牌)
  * 月搜索量500-2000: 8-11分 (成熟品牌)
  * 月搜索量2000+: 12-15分 (强势品牌)

- 预算竞争力得分 (0-10分):
  * 评估最高CPC与市场平均CPC的关系
  * 高于市场平均: 8-10分 (竞争力强)
  * 接近市场平均: 5-7分 (正常竞争)
  * 低于市场平均: 2-4分 (竞争力弱)
  * 明显过低: 0-1分 (可能无法获得曝光)

- 竞争度得分 (0-10分):
  * 低竞争: 8-10分
  * 中等竞争: 4-7分
  * 高竞争: 0-3分

**维度2: 广告质量 (30分)**
评估广告创意的质量和效果。

- 广告强度得分 (0-15分):
  * POOR(差): 0-3分
  * AVERAGE(一般): 4-8分
  * GOOD(良好): 9-12分
  * EXCELLENT(优秀): 13-15分

- 标题多样性得分 (0-8分):
  * 评估15个标题的独特性和多样性
  * 高多样性(>80%): 7-8分
  * 中等多样性(50-80%): 4-6分
  * 低多样性(<50%): 0-3分

- 描述质量得分 (0-7分):
  * 强CTA和卖点: 6-7分
  * 一般但可用: 3-5分
  * 弱或缺少CTA: 0-2分

**维度3: 关键词策略 (20分)**
评估关键词选择和定向策略。

- 相关性得分 (0-8分):
  * 关键词与产品/品牌的匹配程度
  * 高相关性: 7-8分
  * 中等相关性: 4-6分
  * 低相关性: 0-3分

- 匹配类型得分 (0-6分):
  * 精确/词组/广泛匹配均衡: 5-6分
  * 主要使用一种类型: 2-4分
  * 仅使用广泛匹配: 0-1分
  * 注意：如果匹配类型为"Not specified"，给予中等分数(3-4分)

- 否定关键词得分 (0-6分):
  * 完善的否定词列表(20+个): 5-6分
  * 基本覆盖(10-20个): 3-4分
  * 最少覆盖(5-10个): 1-2分
  * 无否定关键词: 0分 (严重问题)

**维度4: 基础配置 (15分)**
评估技术设置和配置。

- 国家/语言匹配得分 (0-5分):
  * 完全匹配: 5分
  * 轻微不匹配: 2-4分
  * 严重不匹配: 0-1分

- 最终网址得分 (0-5分):
  * 有效且相关的URL: 4-5分
  * 有效但不够优化: 2-3分
  * 存在问题: 0-1分

- 预算合理性得分 (0-5分):
  * 预算足够测试: 4-5分
  * 预算紧张: 2-3分
  * 预算过低无法获得有效数据: 0-1分

=== 输出格式 ===
仅返回有效的JSON，使用以下精确结构:

{
  "launchViability": {
    "score": 28,
    "brandSearchVolume": 1500,
    "brandSearchScore": 10,
    "profitMargin": 0,
    "profitScore": 8,
    "competitionLevel": "MEDIUM",
    "competitionScore": 5,
    "issues": ["品牌搜索量偏低，市场认知度不足"],
    "suggestions": ["建议先通过其他渠道提升品牌知名度"]
  },
  "adQuality": {
    "score": 24,
    "adStrength": "GOOD",
    "adStrengthScore": 12,
    "headlineDiversity": 75,
    "headlineDiversityScore": 6,
    "descriptionQuality": 80,
    "descriptionQualityScore": 6,
    "issues": [],
    "suggestions": ["增加更多独特的标题变体"]
  },
  "keywordStrategy": {
    "score": 16,
    "relevanceScore": 7,
    "matchTypeScore": 5,
    "negativeKeywordsScore": 4,
    "totalKeywords": 50,
    "negativeKeywordsCount": 15,
    "matchTypeDistribution": {"EXACT": 20, "PHRASE": 15, "BROAD": 15},
    "issues": ["否定关键词数量不足"],
    "suggestions": ["添加免费、下载、维修等否定关键词"]
  },
  "basicConfig": {
    "score": 12,
    "countryLanguageScore": 5,
    "finalUrlScore": 4,
    "budgetScore": 3,
    "targetCountry": "US",
    "targetLanguage": "English",
    "finalUrl": "https://example.com",
    "dailyBudget": 10,
    "maxCpc": 0.17,
    "issues": ["预算可能不足以应对竞争激烈的关键词"],
    "suggestions": ["建议将日预算提高到20美元"]
  },
  "overallRecommendations": [
    "优先建议1：针对最重要的改进点",
    "重要建议2：显著影响投放效果的优化",
    "可选建议3：进一步提升的方向"
  ]
}

**输出规则（严格遵守）：**
1. 使用上述精确的字段名称
2. 所有评分必须在各维度限制范围内
3. 总分 = launchViability.score + adQuality.score + keywordStrategy.score + basicConfig.score
4. 仅返回JSON对象，不要添加其他文本、markdown标记或代码块
5. **所有issues、suggestions和overallRecommendations必须使用简体中文**
6. profitMargin字段保留但设置为0（不再评估盈亏平衡CPC）
7. 如果某些数据缺失（如匹配类型为"Not specified"），给予合理的中等分数，不要过度惩罚
8. issues数组描述具体问题，suggestions数组提供可操作的改进建议
9. overallRecommendations提供3-5条最重要的综合改进建议',
  'Chinese',
  1,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
);


-- ========================================
-- product_analysis_single: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'product_analysis_single' AND is_active = 1;

-- 2. 插入新版本
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
  is_active,
  change_notes
) VALUES (
  'product_analysis_single',
  'v4.14',
  '产品分析',
  '单品产品分析v4.14',
  '修复字段名不一致：统一使用productHighlights',
  'src/lib/ai.ts',
  'analyzeProductPage',
  'You are a professional product analyst. Analyze the following Amazon product page data comprehensively.

=== INPUT DATA ===
URL: {{pageData.url}}
Brand: {{pageData.brand}}
Title: {{pageData.title}}
Description: {{pageData.description}}

=== FULL PAGE DATA ===
{{pageData.text}}

=== 🎯 ENHANCED DATA (P1 Optimization) ===

**Technical Specifications** (Direct from product detail page):
{{technicalDetails}}

**Review Highlights** (Key points from user reviews):
{{reviewHighlights}}

=== ANALYSIS REQUIREMENTS ===

CRITICAL: Focus ONLY on the MAIN PRODUCT. IGNORE:
- "Customers also bought"
- "Frequently bought together"
- "Related products"
- "Compare with similar items"

Analyze the following dimensions using the data provided:

1. **Product Core** (from Title, Description, PRODUCT FEATURES, ABOUT THIS ITEM):
   - Product name and model
   - Key selling points (USPs)
   - Core features and benefits
   - Target use cases

2. **Technical Analysis** (from TECHNICAL DETAILS section above):
   - 🎯 USE the provided Technical Specifications data above
   - Key specifications that matter to customers
   - Dimensions and compatibility information
   - Material and build quality indicators
   - Technical advantages vs competitors

3. **Pricing Intelligence** (from Price data):
   - Current vs Original price
   - Discount percentage
   - Price competitiveness assessment
   - Value proposition

4. **Review Insights** (from Rating, Review Count, Review Highlights section above):
   - 🎯 USE the provided Review Highlights data above
   - Overall sentiment
   - Key positives customers mention
   - Common concerns or issues
   - Real use cases from reviews
   - Credibility indicators from actual user experience

5. **Market Position** (from Sales Rank, Category, Prime, Badges):
   - Category ranking
   - Prime eligibility impact
   - Quality badges (Amazon''s Choice, Best Seller)
   - Market competitiveness

=== OUTPUT LANGUAGE ===
All output MUST be in {{langName}}.
Category examples: {{categoryExamples}}

=== OUTPUT FORMAT ===
Return a COMPLETE JSON object with this structure:
{
  "productDescription": "Detailed product description emphasizing technical specs and user-validated features",
  "sellingPoints": ["USP 1 (from tech specs)", "USP 2 (from reviews)", "USP 3"],
  "targetAudience": "Description of ideal customers based on use cases",
  "category": "Product category",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "pricing": {
    "current": "$.XX",
    "original": "$.XX or null",
    "discount": "XX% or null",
    "competitiveness": "Premium/Competitive/Budget",
    "valueAssessment": "Analysis of price-to-value ratio"
  },
  "reviews": {
    "rating": 4.5,
    "count": 1234,
    "sentiment": "Positive/Mixed/Negative",
    "positives": ["Pro 1", "Pro 2"],
    "concerns": ["Con 1", "Con 2"],
    "useCases": ["Use case 1", "Use case 2"]
  },
  "promotions": {
    "active": true,
    "types": ["Coupon", "Deal", "Lightning Deal"],
    "urgency": "Limited time offer" or null
  },
  "competitiveEdges": {
    "badges": ["Amazon''s Choice", "Best Seller"],
    "primeEligible": true,
    "stockStatus": "In Stock",
    "salesRank": "#123 in Category"
  },
  "productHighlights": ["Key spec 1 (verified by reviews)", "Key spec 2", "Key spec 3"]
}',
  'Chinese',
  1,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
);


-- ========================================
-- review_analysis: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'review_analysis' AND is_active = 1;

-- 2. 插入新版本
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
  is_active,
  change_notes
) VALUES (
  'review_analysis',
  'v4.14',
  '产品分析',
  '评论分析v4.14',
  '评论分析v3.2 - 增强数字提取和竞品提及分析',
  'src/lib/review-analyzer.ts',
  'analyzeReviews',
  'You are an expert e-commerce review analyst specializing in extracting actionable insights from customer reviews.

=== INPUT DATA ===
Product Name: {{productName}}
Total Reviews: {{totalReviews}}
Target Language: {{langName}}

=== REVIEWS DATA ===
{{reviewTexts}}

=== ANALYSIS REQUIREMENTS ===

1. **Sentiment Distribution** (Quantitative)
   - Calculate positive (4-5 stars), neutral (3 stars), negative (1-2 stars) percentages
   - Provide rating breakdown by star count

2. **Positive Keywords** (Top 10)
   - Extract frequently mentioned positive attributes
   - Include context for each keyword

3. **Negative Keywords** (Top 10)
   - Extract frequently mentioned complaints or issues
   - Include context for each keyword

4. **Real Use Cases** (5-8 scenarios)
   - Identify specific scenarios where customers use the product
   - Extract direct quotes or paraphrased examples

5. **Purchase Reasons** (Top 5)
   - Why customers bought this product
   - What problems they were trying to solve

6. **User Profiles** (3-5 types)
   - Categorize customer types based on their reviews
   - Describe characteristics and needs of each profile

7. **Common Pain Points** (Top 5)
   - Issues customers experienced
   - Severity level and frequency

8. **Quantitative Highlights** (CRITICAL - Extract ALL numbers from reviews)
   **This is the most important section for advertising!**

   Extract EVERY specific number, measurement, or quantifiable claim mentioned in reviews:

   **Performance Metrics:**
   - Battery life: "8 hours", "lasts all day", "3 days on single charge"
   - Suction power: "2000Pa", "powerful suction", "picks up everything"
   - Coverage area: "2000 sq ft", "whole house", "3 bedrooms"
   - Speed/Time: "cleans in 30 minutes", "charges in 2 hours"
   - Capacity: "500ml dustbin", "holds a week of dirt"

   **Usage Duration:**
   - "used for 6 months", "owned for 2 years", "after 3 weeks"
   - "daily use for 1 year", "10 months flawless operation"

   **Frequency:**
   - "runs 3 times per week", "daily cleaning", "every other day"
   - "cleans twice a day", "scheduled for weekdays"

   **Comparison Numbers:**
   - "50% quieter than old one", "2x more powerful"
   - "saves 2 hours per week", "replaces $500 vacuum"

   **Satisfaction Metrics:**
   - "5 stars", "10/10 recommend", "100% satisfied"
   - "would buy again", "best purchase this year"

   **Cost/Value:**
   - "worth every penny", "saved $200", "paid $699"
   - "cheaper than competitors", "half the price"

   For EACH quantitative highlight, provide:
   - metric: Category name (e.g., "Battery Life", "Usage Duration")
   - value: The specific number/measurement (e.g., "8 hours", "6 months")
   - context: Full sentence from review explaining the metric
   - adCopy: Ad-ready format (e.g., "8-Hour Battery Life", "Trusted for 6+ Months")

9. **Competitor Mentions** (Brand comparisons)
   - Which competitor brands are mentioned
   - How this product compares (better/worse/similar)
   - Specific comparison points

=== OUTPUT FORMAT ===
Return ONLY valid JSON (no markdown, no code blocks) with this exact structure:

{
  "totalReviews": number,
  "averageRating": number,
  "sentimentDistribution": {
    "totalReviews": number,
    "positive": number,
    "neutral": number,
    "negative": number,
    "ratingBreakdown": {
      "5_star": number,
      "4_star": number,
      "3_star": number,
      "2_star": number,
      "1_star": number
    }
  },
  "topPositiveKeywords": [
    {
      "keyword": "string",
      "frequency": number,
      "context": "string"
    }
  ],
  "topNegativeKeywords": [
    {
      "keyword": "string",
      "frequency": number,
      "context": "string"
    }
  ],
  "realUseCases": ["string"],
  "purchaseReasons": ["string"],
  "userProfiles": [
    {
      "profile": "string",
      "description": "string"
    }
  ],
  "commonPainPoints": ["string"],
  "quantitativeHighlights": [
    {
      "metric": "string",
      "value": "string",
      "context": "string",
      "adCopy": "string"
    }
  ],
  "competitorMentions": ["string"],
  "analyzedReviewCount": number,
  "verifiedReviewCount": number
}

IMPORTANT: Extract AT LEAST 8-12 quantitative highlights if the reviews contain numbers. Look for ANY mention of time, duration, frequency, measurements, percentages, or comparisons.',
  'Chinese',
  1,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
);


-- ========================================
-- store_highlights_synthesis: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'store_highlights_synthesis' AND is_active = 1;

-- 2. 插入新版本
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
  is_active,
  change_notes
) VALUES (
  'store_highlights_synthesis',
  'v4.14',
  '品牌分析',
  '店铺产品亮点整合v4.14',
  '从热销商品的产品亮点中智能整合提炼出店铺级的核心产品亮点',
  'src/lib/ai.ts',
  'analyzeProductPage',
  'You are a product marketing expert. Analyze the product highlights from {{productCount}} hot-selling products in a brand store and synthesize them into 5-8 key store-level product highlights.

=== INPUT: Product Highlights by Product ===
{{productHighlights}}

=== TASK ===
Synthesize these product-level highlights into 5-8 concise, store-level product highlights that:
1. Identify common themes and technologies across products
2. Highlight unique innovations that differentiate the brand
3. Focus on customer benefits, not just features
4. Use clear, compelling language
5. Avoid repetition

=== OUTPUT FORMAT ===
Return a JSON object with this structure:
{
  "storeHighlights": [
    "Highlight 1 - Brief explanation",
    "Highlight 2 - Brief explanation",
    ...
  ]
}

Output in {{langName}}.',
  'Chinese',
  1,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
);

