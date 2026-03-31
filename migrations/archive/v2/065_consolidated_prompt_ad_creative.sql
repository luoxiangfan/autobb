-- =====================================================
-- Migration: 065_consolidated_prompt_ad_creative.sql
-- Description: 合并广告创意生成Prompts（原064-080中的ad_creative相关）
-- Date: 2025-12-14
--
-- 整合来源:
--   - 064: ad_creative_generation v4.1, ad_elements_headlines v3.2, ad_elements_descriptions v3.2
--   - 066: ad_creative_generation v4.2
--   - 069: ad_creative_generation v4.4
--   - 071: ad_creative_generation v4.5
--   - 073: ad_creative_generation v4.6, ad_elements_headlines v3.3, ad_elements_descriptions v3.3
--   - 077: ad_creative_generation v4.7
--   - 079: ad_creative_generation v4.8
--   - 080: 激活 v4.8
--
-- 最终版本:
--   - ad_creative_generation v4.8 (关键词嵌入率强化)
--   - ad_elements_headlines v3.3 (CTR优化增强)
--   - ad_elements_descriptions v3.3 (CTR优化增强)
-- =====================================================

-- ============================================================
-- PART 1: Deactivate all old versions
-- ============================================================

UPDATE prompt_versions SET is_active = 0 WHERE prompt_id = 'ad_creative_generation' AND is_active = 1;
UPDATE prompt_versions SET is_active = 0 WHERE prompt_id = 'ad_elements_headlines' AND is_active = 1;
UPDATE prompt_versions SET is_active = 0 WHERE prompt_id = 'ad_elements_descriptions' AND is_active = 1;

-- ============================================================
-- PART 2: ad_creative_generation v4.8 (最终版本)
-- ============================================================
-- 关键词嵌入率强化：从27%提升到53%+
-- 保留v4.7 Display Path、v4.6 CTR优化、v4.5店铺数据增强等所有功能

INSERT OR IGNORE INTO prompt_versions (
  prompt_id,
  name,
  version,
  category,
  description,
  file_path,
  function_name,
  prompt_content,
  change_notes,
  is_active
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
- ✅ 正确: "Solar Powered Cameras" (关键词: solar camera)
- ✅ 正确: "Wireless Home Security" (关键词: wireless, home security)
- ❌ 错误: "Camera Camera Security" (关键词堆砌)
- ❌ 错误: "Best Quality Product" (无关键词)

**规则3: 标题类型与关键词匹配**
| 标题类型 | 必须嵌入的关键词类型 | 示例 |
|---------|---------------------|------|
| brand | 品牌词 | "Eufy Security Official" |
| feature | 产品核心词+功能词 | "4K Solar Camera" |
| promo | 产品词+促销词 | "Security Camera Sale" |
| cta | 产品词+行动词 | "Shop Wireless Cameras" |
| urgency | 产品词+紧迫词 | "Camera Deal Ends Soon" |
| social_proof | 品牌词/产品词 | "Top Rated Security Cam" |
| question | 产品词 | "Need Home Security?" |

**规则4: 嵌入数量分配 (总计≥8个)**
- brand类型: 1-2个标题含关键词
- feature类型: 2-3个标题含关键词
- promo类型: 1-2个标题含关键词
- cta类型: 1个标题含关键词
- urgency类型: 1个标题含关键词
- social_proof/question: 1-2个标题含关键词

### 🎯 关键词嵌入示例 (以安防摄像头为例)

**假设关键词列表**: security camera, wireless camera, solar camera, home security, 4K camera, outdoor camera

**正确的15个标题示例 (8个含关键词 ✅)**:
1. "{KeyWord:Eufy} Official" (brand) ✅ 品牌词
2. "4K Security Camera Sale" (promo) ✅ security camera
3. "Wireless Camera No Fees" (feature) ✅ wireless camera
4. "Solar Powered Cameras" (feature) ✅ solar camera
5. "Home Security Made Easy" (feature) ✅ home security
6. "Shop Outdoor Cameras" (cta) ✅ outdoor camera
7. "4K Camera Deal Today" (urgency) ✅ 4K camera
8. "Top Rated Security Cam" (social_proof) ✅ security
9. "Save 30% This Week" (promo)
10. "Free 2-Day Shipping" (promo)
11. "No Monthly Fees Ever" (feature)
12. "24/7 Live Protection" (feature)
13. "Easy DIY Installation" (feature)
14. "30-Day Money Back" (trust)
15. "Award Winning Design" (social_proof)

**关键词嵌入率: 8/15 = 53% ✅**

## 🆕 v4.7 RSA Display Path (保留)

### 🎯 Display Path介绍 (WHAT IS DISPLAY PATH)

**Display Path** 是RSA广告中显示在URL旁边的文字路径，用于提升广告相关性和CTR。
- 展示效果: `example.com/Path1/Path2`
- 与Final URL无关，仅用于展示
- 帮助用户理解点击后会看到什么内容

### 🎯 Display Path要求 (PATH REQUIREMENTS)

**path1 (必填，最多15字符)**:
- 应包含核心产品类别或品牌关键词
- 使用目标语言 {{target_language}}
- ✅ 好例子: "Cameras", "Security", "Solar", "智能摄像", "Telecamere"
- ❌ 避免: 过长词汇、特殊字符、空格

**path2 (可选，最多15字符)**:
- 应包含产品特性、型号或促销信息
- 与path1形成逻辑层级
- ✅ 好例子: "Wireless", "4K-HD", "Sale", "无线", "Offerta"
- ❌ 避免: 与path1重复、无关信息

## 🔥 v4.6 CTR优化增强 (保留)

### 🎯 情感触发词策略 (EMOTIONAL TRIGGERS - CTR +10-15%)

**必须在标题中使用以下情感触发词（至少3个标题）**:

**信任类 (Trust)**:
- "Trusted", "Verified", "#1 Rated", "Official", "Certified"

**独家类 (Exclusivity)**:
- "Exclusive", "Members Only", "VIP", "Limited Edition"

**社会证明类 (Social Proof)**:
- "10000+ Sold", "Best Seller", "Top Rated", "Award Winning"

**价值类 (Value)**:
- "Best Value", "Premium Quality", "Unbeatable", "Superior"

### 🎯 问句式标题 (QUESTION HEADLINES - CTR +5-12%)

**必须**:
- 针对用户痛点或需求提问
- 使用目标语言的疑问词
- ✅ 英语: "Need Home Security?", "Want 4K Quality?", "Looking for Value?"

## 🔥 v4.5 店铺数据增强 (保留)

### 🏪 店铺品牌分析数据利用 (CRITICAL FOR STORE LINKS)

**当检测到店铺分析数据时**:
- **HOT PRODUCT HIGHLIGHTS**: 提取关键词创建标题
- **CUSTOMER PRAISES**: 转化为社会证明标题
- **REAL USE CASES**: 创建场景化标题
- **CUSTOMER CONCERNS**: 主动回应顾虑
- **TRUST INDICATORS**: 在标题中使用信任指标

## 🔥 v4.4 产品特性增强 (保留)

**当检测到 "PRODUCT FEATURES" 数据时**:
- 从PRODUCT FEATURES中提取核心卖点关键词
- 转化为简洁有力的标题（≤30字符）

## 🔥 v4.2 竞争定位增强 (保留)

**1️⃣ 价格优势量化**: "Save €170", "20% Off"
**2️⃣ 独特定位声明**: "The Only", "#1", "Exclusive"
**3️⃣ 隐性竞品对比**: "Unlike others", "Better performance"
**4️⃣ 性价比强调**: "Best Value", "More for Less"

## REQUIREMENTS (Target: EXCELLENT Ad Strength)

### HEADLINES (15 required, ≤30 chars each)
**FIRST HEADLINE (MANDATORY)**: "{KeyWord:{{brand}}} Official" - If exceeds 30 chars, use "{KeyWord:{{brand}}}"
**⚠️ CRITICAL**: ONLY the first headline can use {KeyWord:...} format.

**🚨 v4.8 HEADLINE REQUIREMENTS (强制执行)**:
- 🔥 **Keyword Embedding**: 8/15 (53%+) headlines MUST contain keywords from {{ai_keywords_section}}
- 🔥 **Keyword Verification**: Each headline MUST specify which keyword it contains in "keywords" field
- 🔥 **Emotional Triggers**: 3+ headlines with emotional power words
- 🔥 **Question Headlines**: 1-2 question-style headlines
- 🔥 **Number Usage**: 5+ headlines with specific numbers
- 🔥 **Diversity**: <20% text similarity, no 2+ shared words

**Headline Types (must cover all)**:
{{headline_brand_guidance}}
{{headline_feature_guidance}}
{{headline_promo_guidance}}
{{headline_cta_guidance}}
{{headline_urgency_guidance}}

Length distribution: 5 short(10-20), 5 medium(20-25), 5 long(25-30)

### DESCRIPTIONS (4 required, ≤90 chars each)

**🎯 v4.6 DESCRIPTION REQUIREMENTS**:
- 🔥 **Structured Templates**: Each description MUST follow a DIFFERENT template
- 🔥 **USP Front-Loading**: Strongest USP in first 30 characters
- 🔥 **Social Proof**: 2/4 descriptions must include proof element
- 🔥 **Differentiation**: 1+ description with implicit competitor comparison

**Template Assignment**:
- Description 1: FEATURE-BENEFIT-CTA (value focus)
- Description 2: PROBLEM-SOLUTION-PROOF (trust focus)
- Description 3: OFFER-URGENCY-TRUST (action focus)
- Description 4: USP-DIFFERENTIATION (competitive focus)

{{description_1_guidance}}
{{description_2_guidance}}
{{description_3_guidance}}
{{description_4_guidance}}

### 🆕 DISPLAY PATH (v4.7)

**path1 (必填，≤15字符)**: 核心产品类别或品牌关键词
**path2 (可选，≤15字符)**: 产品特性、型号或促销信息

### KEYWORDS (20-30 required)
**⚠️ 强制约束：所有关键词必须使用目标语言 {{target_language}}**

**第一优先级 - 品牌短尾词 (8-10个)**
**第二优先级 - 产品核心词 (6-8个)**
**第三优先级 - 购买意图词 (3-5个)**
**第四优先级 - 长尾精准词 (3-7个)**

{{exclude_keywords_section}}

### CALLOUTS (4-6, ≤25 chars)
{{callout_guidance}}

### SITELINKS (6): text≤25, desc≤35, url="/"
- Each sitelink must have UNIQUE description
- Cover: product, promo, shipping, contact, reviews, new arrivals

## FORBIDDEN CONTENT:
**❌ Prohibited Words**: "100%", "best", "guarantee", "miracle", ALL CA abuse
**❌ Prohibited Symbols**: ★ ☆ ⭐ 🌟 ✨ © ® ™ • ● ◆ ▪ → ← ↑ ↓ ✓ ✔ ✗ ✘ ❤ ♥ ⚡ 🔥 💎 👍 👎
**❌ Excessive Punctuation**: "!!!", "???", "..."

## 🚨 OUTPUT VALIDATION CHECKLIST (v4.8)

Before generating output, verify:
- [ ] At least 8/15 headlines contain keywords from {{ai_keywords_section}}
- [ ] Each headline with keyword has non-empty "keywords" array
- [ ] keyword_embedding_rate >= 0.53 in quality_metrics
- [ ] keywordEmbeddingRate >= 0.53 in ctr_optimization

## OUTPUT (JSON only, no markdown):
{
  "headlines": [{"text":"...", "type":"brand|feature|promo|cta|urgency|social_proof|question|emotional", "length":N, "keywords":["keyword1", "keyword2"], "hasNumber":bool, "hasUrgency":bool, "hasEmotionalTrigger":bool, "isQuestion":bool}...],
  "descriptions": [{"text":"...", "type":"feature-benefit-cta|problem-solution-proof|offer-urgency-trust|usp-differentiation", "length":N, "hasCTA":bool, "first30Chars":"...", "hasSocialProof":bool}...],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text":"...", "url":"/", "description":"..."}],
  "path1": "...",
  "path2": "...",
  "theme": "...",
  "quality_metrics": {"headline_diversity_score":N, "keyword_embedding_rate":0.53, "emotional_trigger_count":N, "question_headline_count":N, "usp_front_loaded_count":N, "estimated_ad_strength":"EXCELLENT"},
  "ctr_optimization": {"keywordEmbeddingRate":0.53, "emotionalTriggerCount":3, "questionHeadlineCount":2, "uspFrontLoadedDescriptions":4, "displayPathOptimized":true}
}',
  'v4.8合并版: 整合v4.1-v4.8所有优化，关键词嵌入率强化53%+，RSA Display Path，CTR优化，店铺数据增强',
  1
);

-- ============================================================
-- PART 3: ad_elements_headlines v3.3 (最终版本)
-- ============================================================
-- CTR优化增强：DKI模板、数字具体化、情感触发、问句式标题、关键词嵌入率

INSERT OR IGNORE INTO prompt_versions (prompt_id, version, category, name, description, file_path, function_name, prompt_content, is_active, change_notes, created_at)
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

=== TASK ===
Generate 15 Google Search ad headlines (max 30 characters each).

=== 🎯 v3.3 CTR OPTIMIZATION STRATEGIES ===

**Strategy 1: NUMBERS & SPECIFICS** (CTR +15-25%)
- Replace vague words with specific numbers
- Extract from product features: resolution (4K, 8MP), battery (180 Days), storage (128GB)
- Examples: "4K Ultra HD Camera" NOT "High Quality Camera"
- Examples: "180-Day Battery Life" NOT "Long Battery"
- Examples: "Save $50 Today" NOT "Great Savings"

**Strategy 2: EMOTIONAL TRIGGERS** (CTR +10-15%)
Use these power words strategically:
- Trust: "Trusted", "Verified", "#1 Rated", "Official"
- Exclusivity: "Exclusive", "Members Only", "VIP"
- Social Proof: "10000+ Sold", "Best Seller", "Top Rated"
- Value: "Best Value", "Premium Quality", "Unbeatable"

**Strategy 3: QUESTION HEADLINES** (CTR +5-12%)
- Generate 1-2 question-style headlines
- Address user pain points or needs
- Examples: "Need Home Security?", "Want 4K Quality?"

**Strategy 4: DKI-READY TEMPLATES** (CTR +15-25%)
- Create headlines that work with Dynamic Keyword Insertion
- Format: "{KeyWord:Default Text}" - but output the DEFAULT version
- Mark DKI-compatible headlines in analysis
- Examples: "Buy Security Camera" (DKI: "Buy {KeyWord:Security Camera}")

=== HEADLINE GROUPS (15 total) ===

**Group 1: Brand + Product (3 headlines)**
- Must include brand name
- Include core product type
- At least 1 with specific number/spec

**Group 2: Keyword-Rich (3 headlines)**
- Incorporate TOP 3 high-volume keywords
- 🔥 CRITICAL: Each headline MUST contain at least 1 keyword from {{topKeywords}}
- Match search intent naturally

**Group 3: Feature + Number (3 headlines)** 🆕
- Lead with specific numbers from features
- Combine spec + benefit
- Examples: "4K + Night Vision", "8MP Crystal Clear"

**Group 4: Emotional + Social Proof (3 headlines)** 🆕
- Use EMOTIONAL TRIGGERS
- Include trust signals
- Examples: "#1 Rated Camera", "Trusted by 1M+"

**Group 5: Question + CTA (3 headlines)** 🆕
- 1-2 question headlines
- 1-2 strong CTA headlines
- Examples: "Need Security?", "Shop Now & Save"

=== RULES ===
1. Each headline MUST be <= 30 characters (including spaces)
2. 🔥 **Keyword Embedding**: At least 8/15 headlines must contain a keyword from {{topKeywords}}
3. 🔥 **Number Usage**: At least 5/15 headlines must contain specific numbers
4. 🔥 **Diversity**: No two headlines should share more than 2 words
5. Use high-intent language: "Buy", "Shop", "Get", "Save", "Discover"
6. NO quotation marks in headlines
7. Vary headline styles for RSA optimization

=== OUTPUT FORMAT ===
Return JSON:
{
  "headlines": ["headline1", "headline2", ..., "headline15"],
  "headlineAnalysis": {
    "brandHeadlines": [0, 1, 2],
    "keywordHeadlines": [3, 4, 5],
    "featureNumberHeadlines": [6, 7, 8],
    "emotionalProofHeadlines": [9, 10, 11],
    "questionCtaHeadlines": [12, 13, 14],
    "dkiCompatible": [3, 4, 5, 12, 13],
    "keywordsEmbedded": ["keyword1", "keyword2", ...],
    "numbersUsed": ["4K", "180 Days", "$50", ...]
  },
  "ctrOptimization": {
    "keywordEmbeddingRate": 0.6,
    "numberUsageRate": 0.4,
    "emotionalTriggerCount": 3,
    "questionHeadlineCount": 2
  }
}',
  1,
  'v3.3 CTR优化: 1)数字具体化策略 2)情感触发词 3)问句式标题 4)DKI模板支持 5)关键词嵌入率要求(8/15)',
  datetime('now')
);

-- ============================================================
-- PART 4: ad_elements_descriptions v3.3 (最终版本)
-- ============================================================
-- CTR优化增强：结构化模板、USP前置、社会证明、竞品差异化

INSERT OR IGNORE INTO prompt_versions (prompt_id, version, category, name, description, file_path, function_name, prompt_content, is_active, change_notes, created_at)
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
  1,
  'v3.3 CTR优化: 1)结构化描述模板(4种) 2)USP前置规则(前30字符) 3)社会证明嵌入 4)竞品差异化暗示',
  datetime('now')
);

-- ============================================================
-- VERIFICATION
-- ============================================================
-- Run these queries to verify migration success:
-- SELECT prompt_id, version, is_active FROM prompt_versions WHERE prompt_id IN ('ad_creative_generation', 'ad_elements_headlines', 'ad_elements_descriptions') ORDER BY prompt_id, version DESC;
