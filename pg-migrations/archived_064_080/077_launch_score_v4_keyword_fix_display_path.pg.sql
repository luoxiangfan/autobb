-- =====================================================
-- Migration: 077_launch_score_v4_keyword_fix_display_path.pg.sql (PostgreSQL)
-- Date: 2025-12-13
-- Purpose: 整合迁移 - Launch Score v4.0 + Keywords v3.2 + Display Path支持
--
-- 整合内容:
--   Part 1: Launch Score v4.0 - 新4维度评分系统
--   Part 2: Keywords Generation v3.2 - 修复竞品关键词冲突
--   Part 3: ad_creatives表添加path1/path2字段
--   Part 4: ad_creative_generation v4.7 - RSA Display Path支持
--
-- PostgreSQL差异说明:
--   - 使用 IF NOT EXISTS 支持幂等性
--   - 布尔值使用 true/false 而非 1/0
--   - 使用 NOW() 而非 datetime('now')
--   - 支持 COMMENT ON COLUMN 添加字段注释
-- =====================================================

-- ============================================================
-- PART 1: Launch Score v4.0 Dimensions
-- ============================================================
-- New 4-dimension scoring system:
-- 1. Launch Viability (35分): Brand search(15) + Profit margin(10) + Competition(10)
-- 2. Ad Quality (30分): Ad Strength(15) + Headline diversity(8) + Description quality(7)
-- 3. Keyword Strategy (20分): Relevance(8) + Match type(6) + Negative keywords(6)
-- 4. Basic Config (15分): Country/Language(5) + Final URL(5) + Budget(5)

-- Add new dimension score columns (PostgreSQL supports IF NOT EXISTS)
ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS launch_viability_score INTEGER DEFAULT 0;
ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS ad_quality_score INTEGER DEFAULT 0;
ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS keyword_strategy_score INTEGER DEFAULT 0;
ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS basic_config_score INTEGER DEFAULT 0;

-- Add new dimension data columns (JSON)
ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS launch_viability_data TEXT;
ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS ad_quality_data TEXT;
ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS keyword_strategy_data TEXT;
ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS basic_config_data TEXT;

-- Add comments for documentation
COMMENT ON COLUMN launch_scores.launch_viability_score IS 'Launch Viability维度分数(35分): Brand search(15) + Profit margin(10) + Competition(10)';
COMMENT ON COLUMN launch_scores.ad_quality_score IS 'Ad Quality维度分数(30分): Ad Strength(15) + Headline diversity(8) + Description quality(7)';
COMMENT ON COLUMN launch_scores.keyword_strategy_score IS 'Keyword Strategy维度分数(20分): Relevance(8) + Match type(6) + Negative keywords(6)';
COMMENT ON COLUMN launch_scores.basic_config_score IS 'Basic Config维度分数(15分): Country/Language(5) + Final URL(5) + Budget(5)';

-- ============================================================
-- PART 2: Keywords Generation v3.2
-- ============================================================
-- Fix: Prevent competitor brand keyword generation to avoid conflict with negative keywords

-- Deactivate old keyword generation prompt (PostgreSQL uses true/false for boolean)
UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'keywords_generation' AND is_active = true;

-- Insert new keyword generation prompt v3.2
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
  'keywords_generation',
  'v3.2',
  '关键词生成',
  '关键词生成v3.2',
  '修复竞品关键词冲突：禁止生成竞品品牌关键词，避免与否定关键词冲突',
  'src/lib/keyword-generator.ts',
  'generateKeywords',
  'You are a Google Ads keyword expert specializing in e-commerce products.

=== INPUT DATA ===
Brand: {{offer.brand}}
Brand Description: {{offer.brand_description}}
Target Country: {{offer.target_country}}
Category: {{offer.category}}

=== PRODUCT DETAILS ===
Product Name: {{productName}}
Product Features: {{productFeatures}}
Selling Points: {{sellingPoints}}
Price Point: {{pricePoint}}

=== REVIEW INSIGHTS (if available) ===
Top Positive Keywords: {{reviewPositives}}
Common Use Cases: {{reviewUseCases}}
Purchase Reasons: {{purchaseReasons}}

=== COMPETITOR CONTEXT (if available) ===
Competitor Keywords: {{competitorKeywords}}

=== TASK ===
Generate 30 high-quality Google Ads keywords for the {{offer.target_country}} market.

=== KEYWORD STRATEGY ===

1. **Brand Keywords** (5-7 keywords):
   - Brand name + product type
   - Brand + model
   - Brand misspellings (common ones)

2. **Category Keywords** (8-10 keywords):
   - Generic product category
   - Category + feature
   - Category + use case

3. **Feature Keywords** (5-7 keywords):
   - Specific features from product details
   - Technical specifications
   - Unique selling points

4. **Intent Keywords** (5-7 keywords):
   - "best [product]"
   - "[product] for [use case]"
   - "buy [product]"
   - "[product] deals"

5. **Long-tail Keywords** (3-5 keywords):
   - Specific use case queries
   - Problem-solution queries

=== CRITICAL RESTRICTIONS ===
⚠️ DO NOT generate competitor brand keywords:
- DO NOT include competitor brand names (e.g., "Arlo", "Ring", "Blink", "Nest")
- DO NOT include comparison keywords (e.g., "vs Arlo", "alternative to Ring")
- DO NOT include competitor model numbers
- Reason: These will conflict with negative keywords and prevent ads from showing

✅ ONLY generate keywords containing:
- Your own brand name ({{offer.brand}})
- Generic product categories
- Product features and benefits
- Use cases and applications

=== MATCH TYPE RULES ===
- EXACT: Brand terms, high-intent purchase terms
- PHRASE: Feature combinations, category + modifier
- BROAD: Discovery terms, generic categories

=== OUTPUT FORMAT ===
Return JSON:
{
  "keywords": [
    {
      "keyword": "keyword text",
      "matchType": "BROAD|PHRASE|EXACT",
      "priority": "HIGH|MEDIUM|LOW",
      "category": "brand|category|feature|intent|longtail",
      "searchIntent": "informational|commercial|transactional",
      "rationale": "Why this keyword is valuable"
    }
  ],
  "estimatedBudget": {
    "minDaily": 50,
    "maxDaily": 200,
    "currency": "USD",
    "rationale": "Budget reasoning"
  },
  "recommendations": [
    "Strategic recommendation 1",
    "Strategic recommendation 2"
  ]
}

IMPORTANT: Return pure JSON without markdown code blocks.',
  'English',
  1,
  true,
  '修复关键词冲突：明确禁止生成竞品品牌关键词，避免与否定关键词列表冲突。移除comparison queries类别，只保留自有品牌和通用类别关键词。'
);

-- ============================================================
-- PART 3: Add Display Path fields to ad_creatives table
-- ============================================================
-- RSA Display Path用于广告显示URL，提升CTR和广告相关性
-- path1/path2各最多15字符，仅用于展示，不影响Final URL

ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS path1 TEXT DEFAULT NULL;
ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS path2 TEXT DEFAULT NULL;

-- Add comments for documentation
COMMENT ON COLUMN ad_creatives.path1 IS 'RSA Display URL的第一段路径，如 "Cameras"，最多15字符';
COMMENT ON COLUMN ad_creatives.path2 IS 'RSA Display URL的第二段路径，如 "Wireless"，最多15字符';

-- ============================================================
-- PART 4: ad_creative_generation v4.7 - RSA Display Path支持
-- ============================================================

-- Deactivate old creative generation version
UPDATE prompt_versions SET is_active = false WHERE prompt_id = 'ad_creative_generation' AND is_active = true;

-- Insert new v4.7 prompt with Display Path support
INSERT INTO prompt_versions (prompt_id, version, category, name, description, file_path, function_name, prompt_content, is_active, change_notes, created_at)
VALUES (
  'ad_creative_generation',
  'v4.7',
  '广告创意生成',
  '广告创意生成v4.7 - RSA Display Path支持',
  'RSA Display Path支持：生成path1/path2用于展示URL，提升CTR和广告相关性',
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

🎯 **AI增强数据 (v4.7优化 - 2025-12-13)**:
{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

## 🆕 v4.7 RSA Display Path (NEW)

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

### 🎯 Display Path CTR优化策略 (CTR OPTIMIZATION)

**策略1: 关键词匹配 (CTR +10-15%)**
- path1/path2应包含用户可能搜索的关键词
- 从{{ai_keywords_section}}中选择核心词

**策略2: 产品定位 (CTR +5-10%)**
- 反映产品核心类别和特性
- 与标题和描述保持一致

**策略3: 本地化 (CTR +5-8%)**
- 使用目标市场的语言和习惯用语
- 考虑文化差异和本地SEO

**示例组合 (根据产品类型)**:
| 产品类型 | path1 | path2 | 效果 |
|---------|-------|-------|------|
| 安防摄像头 | Security | Cameras | example.com/Security/Cameras |
| 太阳能摄像头 | Solar | 4K-Camera | example.com/Solar/4K-Camera |
| 机器人吸尘器 | Robot | Vacuums | example.com/Robot/Vacuums |
| 意大利市场 | Telecamere | Sicurezza | example.it/Telecamere/Sicurezza |

## 🔥 v4.6 CTR优化增强 (保留)

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

**🎯 v4.6 HEADLINE REQUIREMENTS**:
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

### 🆕 DISPLAY PATH (v4.7 NEW)

**path1 (必填，≤15字符)**:
- 核心产品类别或品牌关键词
- 使用目标语言 {{target_language}}

**path2 (可选，≤15字符)**:
- 产品特性、型号或促销信息
- 与path1形成逻辑层级

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
  "path1": "...",
  "path2": "...",
  "theme": "...",
  "quality_metrics": {"headline_diversity_score":N, "keyword_embedding_rate":N, "emotional_trigger_count":N, "question_headline_count":N, "usp_front_loaded_count":N, "estimated_ad_strength":"EXCELLENT"},
  "ctr_optimization": {"keywordEmbeddingRate":0.53, "emotionalTriggerCount":3, "questionHeadlineCount":2, "uspFrontLoadedDescriptions":4, "displayPathOptimized":true}
}',
  true,
  'v4.7 RSA Display Path: 1)新增path1/path2生成要求 2)Display Path CTR优化策略 3)本地化支持',
  NOW()
);

-- ========== VERIFICATION ==========
-- Run these queries to verify migration success:
-- SELECT prompt_id, version, is_active FROM prompt_versions WHERE prompt_id IN ('keywords_generation', 'ad_creative_generation') ORDER BY prompt_id, version;
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'launch_scores' AND column_name LIKE '%_score' OR column_name LIKE '%_data';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'ad_creatives' AND column_name IN ('path1', 'path2');
