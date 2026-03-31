-- =====================================================
-- Migration: 073_prompt_ctr_optimization_v4.6.pg.sql
-- Date: 2025-12-12
-- Purpose: CTR/CPC优化 - 全面增强标题、描述和核心创意生成
-- 整合内容:
--   1. ad_elements_headlines v3.2 → v3.3
--   2. ad_elements_descriptions v3.2 → v3.3
--   3. ad_creative_generation v4.5 → v4.6
-- PostgreSQL Version
-- =====================================================

-- ========== PART 1: ad_elements_headlines v3.3 ==========

UPDATE prompt_versions SET is_active = false WHERE prompt_id = 'ad_elements_headlines' AND is_active = true;

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
  true,
  'v3.3 CTR优化: 1)数字具体化策略 2)情感触发词 3)问句式标题 4)DKI模板支持 5)关键词嵌入率要求(8/15)',
  NOW()
);

-- ========== PART 2: ad_elements_descriptions v3.3 ==========

UPDATE prompt_versions SET is_active = false WHERE prompt_id = 'ad_elements_descriptions' AND is_active = true;

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
  true,
  'v3.3 CTR优化: 1)结构化描述模板(4种) 2)USP前置规则(前30字符) 3)社会证明嵌入 4)竞品差异化暗示',
  NOW()
);

-- ========== PART 3: ad_creative_generation v4.6 ==========

UPDATE prompt_versions SET is_active = false WHERE prompt_id = 'ad_creative_generation' AND is_active = true;

INSERT INTO prompt_versions (prompt_id, version, category, name, description, file_path, function_name, prompt_content, is_active, change_notes, created_at)
VALUES (
  'ad_creative_generation',
  'v4.6',
  '广告创意生成',
  '广告创意生成v4.6 - CTR优化增强版',
  'CTR优化增强：情感触发词、问句式标题、结构化描述模板、USP前置、关键词嵌入率',
  'src/lib/ad-creative-generator.ts',
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

🎯 **AI增强数据 (v4.6优化 - 2025-12-12)**:
{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

## 🆕 v4.6 CTR优化增强 (CTR OPTIMIZATION - NEW)

### 🎯 情感触发词策略 (EMOTIONAL TRIGGERS - CTR +10-15%)

**必须在标题中使用以下情感触发词（至少3个标题）**:

**信任类 (Trust)**:
- "Trusted", "Verified", "#1 Rated", "Official", "Certified"
- 多语言: "Affidabile", "Verificato", "Certificato" (IT), "Confiable", "Verificado" (ES)

**独家类 (Exclusivity)**:
- "Exclusive", "Members Only", "VIP", "Limited Edition"
- 多语言: "Esclusivo", "Solo per Te" (IT), "Exclusivo", "Solo para Ti" (ES)

**社会证明类 (Social Proof)**:
- "10000+ Sold", "Best Seller", "Top Rated", "Award Winning"
- 多语言: "Più Venduto", "Premiato" (IT), "Más Vendido", "Premiado" (ES)

**价值类 (Value)**:
- "Best Value", "Premium Quality", "Unbeatable", "Superior"
- 多语言: "Miglior Rapporto", "Qualità Premium" (IT), "Mejor Valor", "Calidad Premium" (ES)

### 🎯 问句式标题 (QUESTION HEADLINES - CTR +5-12%)

**必须生成1-2个问句式标题**:
- 针对用户痛点或需求提问
- 使用目标语言的疑问词
- ✅ 英语: "Need Home Security?", "Want 4K Quality?", "Looking for Value?"
- ✅ 意大利语: "Cerchi Sicurezza?", "Vuoi Qualità 4K?", "Cerchi il Miglior Prezzo?"
- ✅ 西班牙语: "¿Necesitas Seguridad?", "¿Quieres Calidad 4K?"

### 🎯 关键词嵌入率 (KEYWORD EMBEDDING - CRITICAL)

**强制要求: 8/15 (53%+) 标题必须包含关键词**
- 从{{ai_keywords_section}}中选择高搜索量关键词
- 自然融入标题，避免堆砌
- 在headlineAnalysis中标记哪些标题包含关键词

## 🆕 v4.6 结构化描述模板 (STRUCTURED DESCRIPTIONS)

**每条描述必须遵循不同的模板结构**:

**模板1: FEATURE-BENEFIT-CTA** (转化率 +10-15%)
- 结构: [核心特性] + [用户收益] + [行动号召]
- ✅ "4K Ultra HD captures every detail. Never miss a moment. Shop now."

**模板2: PROBLEM-SOLUTION-PROOF** (信任度 +20%)
- 结构: [痛点] + [解决方案] + [社会证明]
- ✅ "Worried about security? 24/7 protection. Trusted by 1M+ families."

**模板3: OFFER-URGENCY-TRUST** (CTR +15%)
- 结构: [优惠] + [紧迫感] + [信任信号]
- ✅ "Free Shipping + 30-Day Returns. Limited time. Official Store."

**模板4: USP-DIFFERENTIATION** (转化率 +8%)
- 结构: [独特优势] + [竞品对比暗示] + [价值]
- ✅ "No Monthly Fees. Unlike others, pay once. Best value."

### 🎯 USP前置规则 (USP FRONT-LOADING - CRITICAL)

**每条描述的前30个字符必须包含最强卖点**:
- ✅ "4K Solar Camera..." NOT "This camera has 4K..."
- ✅ "Save €50 Today..." NOT "You can save €50 if..."
- ✅ "No Monthly Fees..." NOT "Unlike other products..."

## 🔥 v4.5 店铺数据增强 (保留)

### 🏪 店铺品牌分析数据利用 (CRITICAL FOR STORE LINKS)

**当检测到店铺分析数据时（BRAND ANALYSIS SECTION包含以下字段）**:

**1️⃣ HOT PRODUCT HIGHLIGHTS - 热销产品亮点 (高转化)**
- 提取关键词创建标题（≤30字符）
- ✅ 示例: "5-in-1 Cleaning", "Ultra-Slim Design"

**2️⃣ CUSTOMER PRAISES - 客户好评 (社会证明)**
- 转化为社会证明标题: "Customers Love Our Quality"

**3️⃣ REAL USE CASES - 真实使用场景 (相关性提升)**
- 创建场景化标题: "Perfect for Home Office"

**4️⃣ CUSTOMER CONCERNS - 客户顾虑 (转化优化)**
- 主动回应顾虑: "Easy Returns", "24/7 Support"

**5️⃣ TRUST INDICATORS - 信任指标 (可信度)**
- 在标题中使用: "Verified Seller", "Top Rated"

## 🔥 v4.4 产品特性增强 (保留)

**当检测到 "PRODUCT FEATURES" 数据时**:
- 从PRODUCT FEATURES中提取核心卖点关键词
- 转化为简洁有力的标题（≤30字符）
- ✅ "5-in-1 Robot Vacuum", "8000Pa Suction Power"

## 🔥 v4.3 销售热度增强 (保留)

**当检测到 "🔥 SALES MOMENTUM" 数据时**:
- ✅ "1K+ Sold This Month", "4K+ Happy Customers"

## 🔥 v4.2 竞争定位增强 (保留)

**1️⃣ 价格优势量化**: "Save €170", "20% Off"
**2️⃣ 独特定位声明**: "The Only", "#1", "Exclusive"
**3️⃣ 隐性竞品对比**: "Unlike others", "Better performance"
**4️⃣ 性价比强调**: "Best Value", "More for Less"

## REQUIREMENTS (Target: EXCELLENT Ad Strength)

### HEADLINES (15 required, ≤30 chars each)
**FIRST HEADLINE (MANDATORY)**: "{KeyWord:{{brand}}} Official" - If exceeds 30 chars, use "{KeyWord:{{brand}}}"
**⚠️ CRITICAL**: ONLY the first headline can use {KeyWord:...} format.

**🎯 v4.6 HEADLINE REQUIREMENTS (NEW)**:
- 🔥 **Keyword Embedding**: 8/15 (53%+) headlines MUST contain keywords
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

**🎯 v4.6 DESCRIPTION REQUIREMENTS (NEW)**:
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
**❌ Prohibited Words**: "100%", "best", "guarantee", "miracle", ALL CAPS abuse
**❌ Prohibited Symbols**: ★ ☆ ⭐ 🌟 ✨ © ® ™ • ● ◆ ▪ → ← ↑ ↓ ✓ ✔ ✗ ✘ ❤ ♥ ⚡ 🔥 💎 👍 👎
**❌ Excessive Punctuation**: "!!!", "???", "..."

## OUTPUT (JSON only, no markdown):
{
  "headlines": [{"text":"...", "type":"brand|feature|promo|cta|urgency|social_proof|question|emotional", "length":N, "keywords":[], "hasNumber":bool, "hasUrgency":bool, "hasEmotionalTrigger":bool, "isQuestion":bool}...],
  "descriptions": [{"text":"...", "type":"feature-benefit-cta|problem-solution-proof|offer-urgency-trust|usp-differentiation", "length":N, "hasCTA":bool, "first30Chars":"...", "hasSocialProof":bool}...],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text":"...", "url":"/", "description":"..."}],
  "theme": "...",
  "quality_metrics": {"headline_diversity_score":N, "keyword_embedding_rate":N, "emotional_trigger_count":N, "question_headline_count":N, "usp_front_loaded_count":N, "estimated_ad_strength":"EXCELLENT"},
  "ctr_optimization": {"keywordEmbeddingRate":0.53, "emotionalTriggerCount":3, "questionHeadlineCount":2, "uspFrontLoadedDescriptions":4}
}',
  true,
  'v4.6 CTR优化: 1)情感触发词策略 2)问句式标题 3)结构化描述模板 4)USP前置规则 5)关键词嵌入率53%+',
  NOW()
);

-- ========== VERIFICATION ==========
-- SELECT prompt_id, version, is_active, LENGTH(prompt_content) as length FROM prompt_versions WHERE prompt_id IN ('ad_elements_headlines', 'ad_elements_descriptions', 'ad_creative_generation') ORDER BY prompt_id, version;
