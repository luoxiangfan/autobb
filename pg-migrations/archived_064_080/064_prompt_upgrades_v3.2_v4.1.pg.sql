-- Migration: 064_prompt_upgrades_v3.2_v4.1.pg.sql
-- Description: 合并prompt升级迁移（v3.2/v4.1深度数据增强版）- PostgreSQL版本
-- Date: 2025-12-09
--
-- 合并内容:
-- 1. product_analysis_single v3.1 → v3.2 (修复productHighlights字段)
-- 2. brand_analysis_store v3.1 → v3.2 (添加productHighlights字段)
-- 3. ad_creative_generation v3.1 → v4.1 (深度数据增强)
-- 4. ad_elements_headlines v3.1 → v3.2 (深度数据增强)
-- 5. ad_elements_descriptions v3.1 → v3.2 (深度数据增强)
--
-- v3.2/v4.1 主要优化:
-- - 店铺深度数据利用: aggregatedReviews, aggregatedFeatures, hotBadges
-- - 竞品特性差异化: competitor features for differentiation
-- - 用户语言模式: 从评论提取自然表达用于广告文案
-- - 增强关键词策略: 新增用户搜索词和类目关键词优先级


-- ========================================
-- PART 1: 产品分析prompt修复
-- ========================================

-- 1.1 停用旧版本prompt
UPDATE prompt_versions SET is_active = FALSE
WHERE prompt_id IN ('product_analysis_single', 'brand_analysis_store')
  AND version = 'v3.1';

-- 1.2 创建单品分析v3.2（修复technicalHighlights → productHighlights）
INSERT INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, language,
  is_active, change_notes
)
SELECT
  prompt_id,
  'v3.2' as version,
  category,
  '单品产品分析v3.2' as name,
  '修复字段名不一致：统一使用productHighlights' as description,
  file_path,
  function_name,
  REPLACE(prompt_content, '"technicalHighlights"', '"productHighlights"') as prompt_content,
  language,
  TRUE as is_active,
  '🔧 修复：将AI返回字段从technicalHighlights统一为productHighlights，解决前端显示"Technical specifications were not provided"的问题' as change_notes
FROM prompt_versions
WHERE prompt_id = 'product_analysis_single' AND version = 'v3.1'
ON CONFLICT (prompt_id, version) DO UPDATE SET
  prompt_content = EXCLUDED.prompt_content,
  is_active = EXCLUDED.is_active,
  change_notes = EXCLUDED.change_notes;

-- 1.3 创建店铺分析v3.2（为热销商品添加productHighlights）
INSERT INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, language,
  is_active, change_notes
)
SELECT
  prompt_id,
  'v3.2' as version,
  category,
  '品牌店铺分析v3.2' as name,
  '为热销商品添加productHighlights字段' as description,
  file_path,
  function_name,
  REPLACE(
    prompt_content,
    '"successFactors": ["Factor 1", "Factor 2"]',
    '"successFactors": ["Factor 1", "Factor 2"],
      "productHighlights": ["Key feature 1", "Key feature 2", "Key feature 3"]'
  ) as prompt_content,
  language,
  TRUE as is_active,
  '🔧 增强：为热销商品添加productHighlights字段，与单品分析保持一致，提供更详细的产品亮点信息' as change_notes
FROM prompt_versions
WHERE prompt_id = 'brand_analysis_store' AND version = 'v3.1'
ON CONFLICT (prompt_id, version) DO UPDATE SET
  prompt_content = EXCLUDED.prompt_content,
  is_active = EXCLUDED.is_active,
  change_notes = EXCLUDED.change_notes;


-- ========================================
-- PART 2: 广告创意生成prompt v4.1
-- ========================================

-- 2.1 将旧版本设为非活跃
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'ad_creative_generation' AND is_active = TRUE;

-- 2.2 插入v4.1版本
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
  'v4.1',
  'ad_creative',
  '广告创意生成v4.1 - 深度数据增强版',
  '利用店铺深度抓取数据、竞品特性对比、用户语言模式生成更高质量更多样的广告创意',
  'src/lib/ad-creative-generator.ts',
  'buildAdCreativePrompt',
  E'{{language_instruction}}

Generate Google Ads creative for {{brand}} ({{category}}).

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}
{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}

🎯 **AI增强数据 (v4.1优化 - 2025-12-09)**:
{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

## 🔥 v4.1 深度数据增强

### 店铺深度数据（当有STORE HOT FEATURES/USER VOICES/TRUST BADGES时）
- **热销商品特性**: 从店铺热销商品详情页聚合的产品特性，代表该品牌最受欢迎的功能点
- **用户真实反馈**: 热销商品的用户评论聚合，反映真实用户关注点
- **信任徽章**: 热销商品获得的Amazon认证（Best Seller、Amazon\'\'s Choice等）
- **类目关键词**: 店铺主营类目，用于长尾关键词拓展

**使用指导**:
1. 标题优先使用热销商品特性（STORE HOT FEATURES）中的卖点
2. 描述融入用户真实反馈（STORE USER VOICES）的表达方式
3. 强调信任徽章（STORE TRUST BADGES）建立可信度
4. 关键词包含类目词（STORE CATEGORIES）的变体

### 竞品差异化数据（当有COMPETITOR FEATURES时）
- **竞品特性列表**: 主要竞品的产品特性，用于找出差异化角度
- **差异化策略**: 避免使用与竞品相同的表达，突出我们独特的优势

**使用指导**:
1. 关键词避免与竞品特性完全重叠，寻找差异化词汇
2. 标题突出"我们有而竞品没有"的功能
3. 描述强调竞争优势而非通用功能

### 用户语言模式（当有USER LANGUAGE PATTERNS时）
- **自然表达**: 从用户评论中提取的常用表达方式
- **使用场景**: 用于生成更自然、更有亲和力的广告文案

**使用指导**:
1. 标题可以使用用户常用的形容词组合（如"easy to use", "really quiet"）
2. 描述模仿用户的表达风格，而非营销语言
3. 关键词包含用户实际搜索的词汇形式

## REQUIREMENTS (Target: EXCELLENT Ad Strength)

### HEADLINES (15 required, ≤30 chars each)
**FIRST HEADLINE (MANDATORY)**: "{KeyWord:{{brand}}} Official" - If this exceeds 30 characters, use "{KeyWord:{{brand}}}" without "Official"
**⚠️ CRITICAL**: ONLY the first headline can use {KeyWord:...} format. All other 14 headlines MUST NOT contain {KeyWord:...} or any DKI syntax.

**🎯 DIVERSITY REQUIREMENT (CRITICAL)**:
- Maximum 20% text similarity between ANY two headlines
- Each headline must have a UNIQUE angle, focus, or emotional trigger
- NO headline should repeat more than 2 words from another headline
- Each headline should use DIFFERENT primary keywords or features
- Vary sentence structure: statements, questions, commands, exclamations
- Use DIFFERENT emotional triggers: trust, urgency, value, curiosity, exclusivity, social proof

**🔥 v4.1 标题角度增强** (必须覆盖以下至少3种):
- **用户证言型**: 使用USER LANGUAGE PATTERNS中的自然表达
- **数据证明型**: 使用评分、评论数、销量排名等具体数字
- **特性聚焦型**: 使用STORE HOT FEATURES中的核心卖点
- **差异优势型**: 强调UNIQUE ADVANTAGES中的竞争优势
- **信任背书型**: 使用STORE TRUST BADGES中的认证标识

Remaining 14 headlines - Types (must cover all 5):
{{headline_brand_guidance}}
{{headline_feature_guidance}}
{{headline_promo_guidance}}
{{headline_cta_guidance}}
{{headline_urgency_guidance}}

Length distribution: 5 short(10-20), 5 medium(20-25), 5 long(25-30)
Quality: 8+ with keywords, 5+ with numbers, 3+ with urgency, <20% text similarity between ANY two headlines

### DESCRIPTIONS (4 required, ≤90 chars each)
**UNIQUENESS REQUIREMENT**: Each description MUST be DISTINCT in focus and wording
**🎯 DIVERSITY REQUIREMENT (CRITICAL)**:
- Maximum 20% text similarity between ANY two descriptions
- Each description must have a COMPLETELY DIFFERENT focus and angle
- NO description should repeat more than 2 words from another description
- Use DIFFERENT emotional triggers and value propositions
- Vary the structure: benefit-focused, action-focused, feature-focused, proof-focused

{{description_1_guidance}}
{{description_2_guidance}}
{{description_3_guidance}}
{{description_4_guidance}}

**🔥 v4.1 描述角度增强**:
- ✓ Description 1: VALUE - 使用STORE HOT FEATURES的核心卖点
- ✓ Description 2: ACTION - 结合促销信息的行动号召
- ✓ Description 3: PROOF - 使用TOP REVIEWS/SOCIAL PROOF的真实数据
- ✓ Description 4: VOICE - 模仿USER LANGUAGE PATTERNS的自然表达

**CRITICAL DIVERSITY CHECKLIST**:
- ✓ Each uses DIFFERENT keywords and phrases
- ✓ Each has a DIFFERENT emotional trigger
- ✓ Maximum 20% similarity between any two descriptions
**LEVERAGE DATA**: {{review_data_summary}}
{{competitive_guidance_section}}

### KEYWORDS (20-30 required)
**🎯 关键词生成策略（v4.1增强 - 确保多样性和搜索量）**:
**⚠️ 强制约束：所有关键词必须使用目标语言 {{target_language}}，不能使用英文！**

**第一优先级 - 品牌短尾词 (必须生成8-10个)**:
- 格式: [品牌名] + [产品核心词]（2-3个单词）
- ✅ 必须包含的品牌短尾词（基于 {{brand}}）:
  - "{{brand}} {{category}}"（品牌+品类）
  - "{{brand}} official"（品牌+官方）
  - "{{brand}} store"（品牌+商店）
  - "{{brand}} [型号/系列]"（如有型号信息）
  - "{{brand}} buy"（品牌+购买）
  - "{{brand}} price"（品牌+价格）
  - "{{brand}} review"（品牌+评测）
  - "{{brand}} [主要特性]"（品牌+特性）

**第二优先级 - 产品核心词 (必须生成6-8个)**:
- 格式: [产品功能] + [类别]（2-3个单词）

**第三优先级 - 购买意图词 (必须生成3-5个)**:
- 格式: [购买动词] + [品牌/产品]

**第四优先级 - 长尾精准词 (必须生成3-7个)**:
- 格式: [具体场景] + [产品]（3-5个单词）

**🔥 v4.1新增 - 第五优先级 - 用户搜索词 (2-4个)**:
- 来源: USER LANGUAGE PATTERNS 和 POSITIVE KEYWORDS
- 格式: 用户在评论中高频提及的产品表达
- 示例: "easy to use [product]", "quiet [product]", "best [product] for pets"

**🔥 v4.1新增 - 第六优先级 - 类目长尾词 (2-4个，店铺场景)**:
- 来源: STORE CATEGORIES
- 格式: [类目名] + [品牌/产品特性]
- 示例: "home appliances {{brand}}", "[category] with [feature]"

**🔴 强制语言要求**:
- 关键词必须使用目标语言 {{target_language}}
- 如果目标语言是意大利语，所有关键词必须是意大利语
- 如果目标语言是西班牙语，所有关键词必须是西班牙语
- 不能混合使用英文和目标语言
- 不能使用英文关键词
{{exclude_keywords_section}}

### CALLOUTS (4-6, ≤25 chars)
{{callout_guidance}}
**🔥 v4.1增强**: 优先使用STORE TRUST BADGES和SOCIAL PROOF数据

### SITELINKS (6): text≤25, desc≤35, url="/" (auto-replaced)
- **REQUIREMENT**: Each sitelink must have a UNIQUE, compelling description
- Focus on different product features, benefits, or use cases
- Avoid repeating similar phrases across sitelinks

## FORBIDDEN CONTENT:
**❌ Prohibited Words**: "100%", "best", "guarantee", "miracle", ALL CAPS abuse
**❌ Prohibited Symbols (Google Ads Policy)**: ★ ☆ ⭐ 🌟 ✨ © ® ™ • ● ◆ ▪ → ← ↑ ↓ ✓ ✔ ✗ ✘ ❤ ♥ ⚡ 🔥 💎 👍 👎
  * Use text alternatives instead: "stars" or "star rating" instead of ★
  * Use "Rated 4.8 stars" NOT "4.8★"
**❌ Excessive Punctuation**: "!!!", "???", "...", repeated exclamation marks

## OUTPUT (JSON only, no markdown):
{
  "headlines": [{"text":"...", "type":"brand|feature|promo|cta|urgency|user_voice|data_proof|trust", "length":N, "keywords":[], "hasNumber":bool, "hasUrgency":bool}...],
  "descriptions": [{"text":"...", "type":"value|cta|proof|voice", "length":N, "hasCTA":bool, "keywords":[]}...],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text":"...", "url":"/", "description":"..."}],
  "theme": "...",
  "quality_metrics": {"headline_diversity_score":N, "keyword_relevance_score":N, "data_utilization_score":N, "estimated_ad_strength":"EXCELLENT"}
}',
  'English',
  TRUE,
  'v4.1优化: 1)店铺深度数据利用(aggregatedReviews/Features/Badges) 2)竞品特性差异化 3)用户语言模式提取 4)关键词新增用户搜索词和类目词优先级 5)标题描述角度增强指引'
)
ON CONFLICT (prompt_id, version) DO UPDATE SET
  prompt_content = EXCLUDED.prompt_content,
  is_active = EXCLUDED.is_active,
  change_notes = EXCLUDED.change_notes;


-- ========================================
-- PART 3: 广告元素提取prompt v3.2
-- ========================================

-- 3.1 ad_elements_headlines v3.1 → v3.2
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'ad_elements_headlines' AND is_active = TRUE;

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
  'v3.2',
  'ad_creative',
  '广告标题生成v3.2 - 深度数据增强版',
  '利用店铺深度抓取数据、竞品特性、用户语言模式生成更高质量更多样的广告标题',
  'src/lib/ad-elements-extractor.ts',
  'generateHeadlines',
  E'You are a professional Google Ads copywriter specializing in high-CTR headlines.

=== PRODUCT INFORMATION ===
Product Name: {{product.name}}
Brand: {{product.brand}}
Rating: {{product.rating}} ({{product.reviewCount}} reviews)
Price: {{product.price}}

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

=== 🔥 v3.2 DEEP DATA ENHANCEMENT ===

**STORE HOT FEATURES** (from best-selling products):
{{storeHotFeatures}}
→ These are the most popular features from the brand\'\'s top-selling products. Use them to create feature-focused headlines.

**STORE USER VOICES** (aggregated reviews from hot products):
{{storeUserVoices}}
→ Real customer feedback patterns. Use natural language expressions for authentic headlines.

**TRUST BADGES** (brand credibility indicators):
{{trustBadges}}
→ Amazon\'\'s Choice, Best Seller, etc. Use for trust-building headlines.

**USER LANGUAGE PATTERNS** (natural expressions from reviews):
{{userLanguagePatterns}}
→ How customers naturally describe the product. Mirror these patterns for relatable headlines.

**COMPETITOR FEATURES** (for differentiation):
{{competitorFeatures}}
→ Avoid duplicating these. Focus on unique advantages not found in competitors.

**TOP REVIEW QUOTES** (authentic customer voices):
{{topReviewQuotes}}
→ Use these exact phrases or adapt them for social proof headlines.

=== TASK ===
Generate 15 Google Search ad headlines (max 30 characters each).

=== HEADLINE STRATEGY (v3.2 Enhanced) ===

**Group 1: Brand + Product (3 headlines)**
- Must include brand name
- Include core product type
- Examples: "Reolink 4K Security Camera", "eufy Smart Home Camera"

**Group 2: Keyword-Rich (3 headlines)**
- Incorporate high-volume keywords naturally
- Match search intent
- Use product categories for broader reach

**Group 3: Feature-Focused (3 headlines)** 🔥 NEW
- **Priority**: Use STORE HOT FEATURES data
- Highlight USPs from top-selling products
- Combine features with category context

**Group 4: User Voice (3 headlines)** 🔥 NEW
- Use USER LANGUAGE PATTERNS for natural expressions
- Adapt TOP REVIEW QUOTES into headlines
- Examples: "Easy Setup, Works Great", "Quiet & Reliable"

**Group 5: Trust & Proof (3 headlines)** 🔥 NEW
- Use TRUST BADGES and social proof data
- Include ratings/review counts when compelling
- Examples: "4.8★ Rated by 10K+", "Amazon\'\'s Choice Award"

=== RULES ===
1. Each headline MUST be <= 30 characters (including spaces)
2. Use high-intent language: "Buy", "Shop", "Get", "Save"
3. NO DKI dynamic insertion syntax
4. NO quotation marks in headlines
5. Vary headline styles for RSA optimization
6. 🔥 **Diversity**: No two headlines should share more than 2 words
7. 🔥 **Authenticity**: At least 3 headlines should use USER LANGUAGE PATTERNS
8. 🔥 **Differentiation**: Avoid features that appear in COMPETITOR FEATURES

=== OUTPUT FORMAT ===
Return JSON:
{
  "headlines": ["headline1", "headline2", ..., "headline15"],
  "headlineAnalysis": {
    "brandHeadlines": [0, 1, 2],
    "keywordHeadlines": [3, 4, 5],
    "featureHeadlines": [6, 7, 8],
    "userVoiceHeadlines": [9, 10, 11],
    "trustHeadlines": [12, 13, 14]
  },
  "dataUtilization": {
    "storeHotFeaturesUsed": true,
    "userLanguagePatternsUsed": true,
    "trustBadgesUsed": true
  }
}',
  'English',
  TRUE,
  'v3.2优化: 1)新增店铺深度数据变量 2)新增竞品差异化变量 3)新增用户语言模式 4)新增热门评论引用 5)标题分组增加User Voice和Trust类型 6)增强多样性和真实性要求'
)
ON CONFLICT (prompt_id, version) DO UPDATE SET
  prompt_content = EXCLUDED.prompt_content,
  is_active = EXCLUDED.is_active,
  change_notes = EXCLUDED.change_notes;


-- 3.2 ad_elements_descriptions v3.1 → v3.2
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'ad_elements_descriptions' AND is_active = TRUE;

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
  'v3.2',
  'ad_creative',
  '广告描述生成v3.2 - 深度数据增强版',
  '利用店铺深度抓取数据、竞品特性、用户语言模式生成更高质量更多样的广告描述',
  'src/lib/ad-elements-extractor.ts',
  'generateDescriptions',
  E'You are a professional Google Ads copywriter specializing in high-converting descriptions.

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

=== 🔥 v3.2 DEEP DATA ENHANCEMENT ===

**STORE HOT FEATURES** (from best-selling products):
{{storeHotFeatures}}
→ Use these proven features in VALUE descriptions.

**STORE USER VOICES** (aggregated reviews from hot products):
{{storeUserVoices}}
→ Authentic customer language. Use in VOICE descriptions.

**TRUST BADGES** (brand credibility indicators):
{{trustBadges}}
→ Use for PROOF descriptions to build credibility.

**USER LANGUAGE PATTERNS** (natural expressions from reviews):
{{userLanguagePatterns}}
→ Mirror these patterns for relatable, natural-sounding descriptions.

**COMPETITOR FEATURES** (for differentiation):
{{competitorFeatures}}
→ Highlight our unique advantages not found in competitors.

**TOP REVIEW QUOTES** (authentic customer voices):
{{topReviewQuotes}}
→ Adapt or quote directly for social proof.

=== TASK ===
Generate 4 Google Search ad descriptions (max 90 characters each).

=== DESCRIPTION STRATEGY (v3.2 Enhanced) ===

**Description 1: VALUE** 🔥 Use STORE HOT FEATURES
- Lead with strongest product feature from hot-selling products
- Connect to customer benefit
- Why this product is worth buying
- Example: "4K Ultra HD captures every detail. Smart detection reduces false alerts by 90%."

**Description 2: ACTION**
- Strong call-to-action with promotion info
- Create urgency when appropriate
- Clear next step for the user
- Example: "Save 20% this week. Free shipping + 30-day returns. Shop now."

**Description 3: PROOF** 🔥 Use TRUST BADGES + TOP REVIEW QUOTES
- Use review insights and trust badges
- Include specific numbers for credibility
- Social proof and authority signals
- Example: "Trusted by 10,000+ homeowners. 4.8★ rated. Amazon\'\'s Choice."

**Description 4: VOICE** 🔥 Use USER LANGUAGE PATTERNS
- Mimic how customers naturally describe the product
- Use expressions from STORE USER VOICES
- Relatable, authentic tone (not marketing-speak)
- Example: "Easy to set up, works great. Customers love the quiet operation."

=== RULES ===
1. Each description MUST be <= 90 characters (including spaces)
2. Include at least one call-to-action per description
3. Use active voice and present tense
4. Avoid generic phrases - be specific to product
5. Include price/discount when compelling
6. 🔥 **Diversity**: Each description must have a COMPLETELY DIFFERENT focus
7. 🔥 **Authenticity**: Description 4 MUST use USER LANGUAGE PATTERNS
8. 🔥 **Differentiation**: Highlight advantages NOT in COMPETITOR FEATURES

=== OUTPUT FORMAT ===
Return JSON:
{
  "descriptions": ["description1", "description2", "description3", "description4"],
  "descriptionTypes": ["value", "action", "proof", "voice"],
  "dataUtilization": {
    "storeHotFeaturesUsed": true,
    "userLanguagePatternsUsed": true,
    "trustBadgesUsed": true,
    "topReviewQuotesUsed": true
  }
}',
  'English',
  TRUE,
  'v3.2优化: 1)新增店铺深度数据变量 2)新增竞品差异化变量 3)新增用户语言模式 4)新增热门评论引用 5)描述类型改为VALUE/ACTION/PROOF/VOICE 6)增强多样性和真实性要求'
)
ON CONFLICT (prompt_id, version) DO UPDATE SET
  prompt_content = EXCLUDED.prompt_content,
  is_active = EXCLUDED.is_active,
  change_notes = EXCLUDED.change_notes;


-- ========================================
-- 确保所有新版本为活跃状态
-- ========================================
UPDATE prompt_versions SET is_active = TRUE
WHERE (prompt_id = 'product_analysis_single' AND version = 'v3.2')
   OR (prompt_id = 'brand_analysis_store' AND version = 'v3.2')
   OR (prompt_id = 'ad_creative_generation' AND version = 'v4.1')
   OR (prompt_id = 'ad_elements_headlines' AND version = 'v3.2')
   OR (prompt_id = 'ad_elements_descriptions' AND version = 'v3.2');
