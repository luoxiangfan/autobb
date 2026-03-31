-- =====================================================
-- Migration: 071_update_prompts_v3.3_v4.5.sql
-- Purpose: Combined prompt updates for brand analysis and ad creative generation
-- Date: 2025-12-11
--
-- This migration combines:
-- - brand_analysis_store v3.3: Support aggregated product features and review highlights
-- - ad_creative_generation v4.5: Leverage store analysis data for better ad creatives
--
-- Changes in brand_analysis_store v3.3:
-- 1. Add PRODUCT FEATURES section from deepScrapeResults.aggregatedFeatures
-- 2. Add REVIEW HIGHLIGHTS section from deepScrapeResults.aggregatedReviews
-- 3. Add reviewAnalysis output field
-- 4. Better guidance for using new data sections
--
-- Changes in ad_creative_generation v4.5:
-- 1. Add STORE BRAND ANALYSIS section for store-specific data
-- 2. Add HOT PRODUCT HIGHLIGHTS guidance
-- 3. Add STORE REVIEW INSIGHTS guidance
-- 4. Add CUSTOMER USE CASES for relevance
-- =====================================================

-- =====================================================
-- PART 1: brand_analysis_store v3.3
-- =====================================================

-- Step 1.1: Deactivate current version
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'brand_analysis_store' AND is_active = 1;

-- Step 1.2: Delete existing v3.3 if exists (for idempotent migration)
DELETE FROM prompt_versions WHERE prompt_id = 'brand_analysis_store' AND version = 'v3.3';

-- Step 1.3: Insert new version v3.3
INSERT INTO prompt_versions (
  prompt_id,
  version,
  name,
  description,
  category,
  file_path,
  function_name,
  prompt_content,
  is_active,
  created_at
) VALUES (
  'brand_analysis_store',
  'v3.3',
  '品牌店铺分析v3.3 - 深度数据增强版',
  '支持从热销商品深度抓取的聚合特性和评论数据，生成更准确的产品亮点和评论分析',
  '品牌分析',
  'src/lib/ai.ts',
  'analyzeProductPage',
  'You are a professional brand analyst. Analyze the BRAND STORE PAGE data and extract comprehensive brand information.

=== INPUT DATA ===
URL: {{pageData.url}}
Brand: {{pageData.brand}}
Title: {{pageData.title}}
Description: {{pageData.description}}

=== STORE DATA (Including Hot-Selling Products) ===
{{pageData.text}}

=== ANALYSIS METHODOLOGY ===

Hot Score Formula: Rating × log10(Review Count + 1)
- 🔥 TOP 5 HOT-SELLING = highest scores (proven winners)
- ✅ Other best sellers = good performers

🎯 **IMPORTANT**: If PRODUCT FEATURES or REVIEW HIGHLIGHTS sections are present in the store data above:
- USE them to generate accurate productHighlights for hot products
- USE them to create meaningful reviewAnalysis
- These are REAL data from actual product pages, not guesses

=== ANALYSIS PRIORITIES ===

1. **Hot Products Analysis** (TOP 5 by Hot Score):
   - Product names and categories
   - Price points and positioning
   - Review scores and volume
   - Why these products succeed
   - 🎯 Product features (from PRODUCT FEATURES section if available)

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

5. **Quality Indicators**:
   - Amazon''s Choice badges
   - Best Seller rankings
   - Prime eligibility
   - Active promotions
   - High review counts (500+)

6. **Review Analysis** (🔥 NEW - from REVIEW HIGHLIGHTS section):
   - Overall customer sentiment
   - Common positives mentioned
   - Common concerns or complaints
   - Use cases validated by customers

=== OUTPUT LANGUAGE ===
All output MUST be in {{langName}}.
Category examples: {{categoryExamples}}

=== OUTPUT FORMAT ===
Return a COMPLETE JSON object with this structure:
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
      "productHighlights": ["Key feature 1 (from PRODUCT FEATURES)", "Key feature 2", "Key feature 3"]
    }
  ],
  "reviewAnalysis": {
    "overallSentiment": "Positive/Mixed/Negative",
    "positives": ["Common positive 1 (from REVIEW HIGHLIGHTS)", "Common positive 2"],
    "concerns": ["Common concern 1", "Common concern 2"],
    "customerUseCases": ["Use case 1", "Use case 2"],
    "trustIndicators": ["High review counts", "Verified purchases", etc.]
  },
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
  1,
  CURRENT_TIMESTAMP
);

-- =====================================================
-- PART 2: ad_creative_generation v4.5
-- =====================================================

-- Step 2.1: Deactivate current version
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_creative_generation' AND is_active = 1;

-- Step 2.2: Delete existing v4.5 if exists (for idempotent migration)
DELETE FROM prompt_versions WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.5';

-- Step 2.3: Insert new version v4.5
INSERT INTO prompt_versions (
  prompt_id,
  version,
  name,
  description,
  category,
  file_path,
  function_name,
  prompt_content,
  is_active,
  created_at
) VALUES (
  'ad_creative_generation',
  'v4.5',
  '广告创意生成v4.5 - 店铺数据增强版',
  '支持店铺分析数据（热销产品亮点、评论分析、客户使用场景）生成更相关的广告创意',
  '广告创意生成',
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

🎯 **AI增强数据 (v4.5优化 - 2025-12-11)**:
{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

## 🆕 v4.5 店铺数据增强 (STORE DATA OPTIMIZATION)

### 🏪 店铺品牌分析数据利用 (CRITICAL FOR STORE LINKS)

**当检测到店铺分析数据时（BRAND ANALYSIS SECTION包含以下字段）**:
这是从Amazon店铺页面热销商品深度抓取的真实数据，对店铺链接广告至关重要！

**1️⃣ HOT PRODUCT HIGHLIGHTS - 热销产品亮点 (高转化)**
- 这些是店铺最畅销产品的核心卖点，已被市场验证
- **必须使用策略**:
  - 提取关键词创建标题（≤30字符）
  - ✅ 示例: "5-in-1 Cleaning", "Ultra-Slim Design", "Smart App Control"
  - 在描述中融入这些经过验证的卖点

**2️⃣ CUSTOMER PRAISES - 客户好评 (社会证明)**
- 真实客户的正面评价主题
- **必须使用策略**:
  - 转化为社会证明标题: "Customers Love Our Quality"
  - 在描述中引用: "See why customers rave about..."
  - ✅ 示例: "Great Value", "Easy Setup", "Reliable Performance"

**3️⃣ REAL USE CASES - 真实使用场景 (相关性提升)**
- 实际客户验证的使用场景
- **必须使用策略**:
  - 创建场景化标题: "Perfect for Home Office"
  - 在描述中展示使用场景: "Ideal for busy families..."
  - ✅ 示例: "Home Use", "Office Setup", "Travel Companion"

**4️⃣ CUSTOMER CONCERNS - 客户顾虑 (转化优化)**
- 了解客户的常见担忧
- **必须使用策略**:
  - 主动在广告中回应这些顾虑
  - 创建信任建立标题: "Easy Returns", "24/7 Support"
  - ✅ 示例: 如果顾虑是"durability"，使用"Built to Last"

**5️⃣ TRUST INDICATORS - 信任指标 (可信度)**
- 店铺的信任信号
- **必须使用策略**:
  - 在标题中使用: "Verified Seller", "Top Rated"
  - 在描述中强调: "Trusted by thousands..."

## 🔥 v4.4 产品特性增强 (保留)

### 📦 产品特性数据利用 (CRITICAL FOR RELEVANCE)

**当检测到 "PRODUCT FEATURES" 数据时**:
这是从Amazon产品页面"About this item"直接抓取的真实产品卖点，是最准确的产品描述！

**必须使用的创意策略**:

**1️⃣ 产品特性标题 (Feature Headlines - 高相关性)**
- 从PRODUCT FEATURES中提取核心卖点关键词
- 转化为简洁有力的标题（≤30字符）
- ✅ 示例转化:
  - "5-IN-1 CLEANING POWER" → "5-in-1 Robot Vacuum"
  - "ULTRA-SLIM DESIGN" → "Ultra-Slim Design"
  - "8000Pa Strong Suction" → "8000Pa Suction Power"
  - "Smart App Control" → "Smart App Control"

**2️⃣ 技术规格标题 (SPECS Headlines)**
- 从SPECS数据中提取关键技术参数
- 使用数字增强说服力
- ✅ 示例:
  - "Surface Recommendation: Multi-surface" → "Multi-Surface Cleaning"
  - "Item Weight: 19.8 Pounds" → "Lightweight 19.8 lbs"
  - "Controller Type: Voice Control" → "Voice Controlled"

**3️⃣ 描述中的特性引用 (Description Feature Integration)**
- 在描述中自然融入产品特性
- 确保描述具体且有说服力
- ✅ 示例:
  - "5-in-1 cleaning power with 8000Pa suction. Ultra-slim design fits under furniture."
  - "Smart app control with voice command support. Clean anywhere, anytime."

**4️⃣ 关键词增强 (Keyword Enhancement)**
- 从PRODUCT FEATURES中提取高相关性关键词
- 确保关键词覆盖产品核心功能
- ✅ 从特性中提取的关键词示例:
  - "robot vacuum 5 in 1"
  - "ultra slim robot vacuum"
  - "8000pa suction vacuum"
  - "smart app robot vacuum"

## 🔥 v4.3 销售热度增强 (保留)

### 📈 销售热度数据利用 (CRITICAL FOR CONVERSION)

**当检测到 "🔥 SALES MOMENTUM" 数据时**:
这是Amazon直接提供的真实销量数据，是最强的社会证明信号！

**必须使用的创意策略**:

**1️⃣ 热销证明标题 (Social Proof Headlines - 高CTR)**
- 将销量数据转化为信任信号标题
- ✅ "1K+ Sold This Month", "4K+ Happy Customers", "Best Seller - 5K+ Sold"

**2️⃣ 描述中的销量引用 (Description Social Proof)**
- 在至少1条描述中引用销量数据
- ✅ "Join 4,000+ customers who bought this month"

**3️⃣ 紧迫感+销量组合 (Urgency + Volume)**
- 结合折扣和销量创造紧迫感
- ✅ "Trending: 1K+ Sold | Save 20%"

## 🔥 v4.2 竞争定位增强 (保留)

### ⚡ 竞争定位必备元素 (CRITICAL FOR AD STRENGTH)

**1️⃣ 价格优势量化 (Price Advantage - 3分)**
- 必须在至少2条标题或描述中包含具体数字的价格优势
- ✅ 正确格式: "Save €170", "20% Off", "From €99"

**2️⃣ 独特定位声明 (Unique Market Position - 3分)**
- 必须在至少1条标题中使用独特性声明词汇
- ✅ 英语: "The Only", "First", "#1", "Exclusive", "Original"

**3️⃣ 隐性竞品对比 (Implicit Comparison - 2分)**
- 使用暗示性对比词汇，但不直接提及竞争对手
- ✅ "Unlike others", "Better performance", "Superior quality"

**4️⃣ 性价比强调 (Value for Money - 2分)**
- 强调产品物超所值
- ✅ "Best Value", "Premium at Budget Price", "More for Less"

## REQUIREMENTS (Target: EXCELLENT Ad Strength)

### HEADLINES (15 required, ≤30 chars each)
**FIRST HEADLINE (MANDATORY)**: "{KeyWord:{{brand}}} Official" - If this exceeds 30 characters, use "{KeyWord:{{brand}}}" without "Official"
**⚠️ CRITICAL**: ONLY the first headline can use {KeyWord:...} format. All other 14 headlines MUST NOT contain {KeyWord:...} or any DKI syntax.

**🎯 DIVERSITY REQUIREMENT (CRITICAL)**:
- Maximum 20% text similarity between ANY two headlines
- Each headline must have a UNIQUE angle, focus, or emotional trigger
- NO headline should repeat more than 2 words from another headline

**🆕 v4.5 STORE DATA HEADLINES (NEW - FOR STORE LINKS)**:
- If HOT PRODUCT HIGHLIGHTS available, create 2-3 headlines from verified selling points
- If CUSTOMER PRAISES available, create 1-2 social proof headlines
- If REAL USE CASES available, create 1-2 scenario-based headlines
- Examples: "Customers Love It", "Perfect for Home", "Top-Rated Quality"

**🔥 v4.4 PRODUCT FEATURES HEADLINES**:
- If PRODUCT FEATURES data available, create 3-4 headlines directly from product features
- Extract key selling points and convert to concise headlines
- Examples: "5-in-1 Cleaning Power", "Ultra-Slim Design", "8000Pa Suction"

**🔥 v4.3 SALES MOMENTUM HEADLINES**:
- If SALES MOMENTUM data available, create 2-3 headlines using sales volume
- Examples: "1K+ Sold This Month", "Join 4K+ Buyers", "Best Seller"

Remaining headlines - Types (must cover all 5):
{{headline_brand_guidance}}
{{headline_feature_guidance}}
{{headline_promo_guidance}}
{{headline_cta_guidance}}
{{headline_urgency_guidance}}

Length distribution: 5 short(10-20), 5 medium(20-25), 5 long(25-30)
Quality: 8+ with keywords, 5+ with numbers, 3+ with urgency, <20% text similarity

### DESCRIPTIONS (4 required, ≤90 chars each)
**UNIQUENESS REQUIREMENT**: Each description MUST be DISTINCT in focus and wording

**🆕 v4.5 STORE DATA DESCRIPTIONS (NEW - FOR STORE LINKS)**:
- At least 1 description MUST incorporate store analysis data if available
- Use CUSTOMER PRAISES for social proof: "Customers love our quality and service"
- Use REAL USE CASES for relevance: "Perfect for home, office, or on-the-go"
- Address CUSTOMER CONCERNS proactively: "Easy setup, hassle-free returns"

**🔥 v4.4 PRODUCT FEATURES DESCRIPTIONS**:
- At least 1 description MUST incorporate specific product features from PRODUCT FEATURES data
- Use authentic product selling points for higher relevance and quality score
- Example: "5-in-1 cleaning with 8000Pa suction. Ultra-slim fits under furniture."

**🔥 v4.3 SALES MOMENTUM DESCRIPTIONS**:
- If SALES MOMENTUM data available, include in at least 1 description
- Example: "Join 4,000+ customers who bought this month. Shop now!"

{{description_1_guidance}}
{{description_2_guidance}}
{{description_3_guidance}}
{{description_4_guidance}}

**CRITICAL DIVERSITY CHECKLIST**:
- ✓ Description 1 focuses on VALUE (what makes it special)
- ✓ Description 2 focuses on ACTION (what to do now)
- ✓ Description 3 focuses on FEATURES (USE PRODUCT FEATURES or STORE DATA HERE)
- ✓ Description 4 focuses on PROOF (social proof + sales momentum + customer praises)
**LEVERAGE DATA**: {{review_data_summary}}
{{competitive_guidance_section}}

### KEYWORDS (20-30 required)
**🎯 关键词生成策略（重要！确保高搜索量关键词优先）**:
**⚠️ 强制约束：所有关键词必须使用目标语言 {{target_language}}，不能使用英文！**

**🆕 v4.5 店铺数据关键词 (NEW)**:
- 从HOT PRODUCT HIGHLIGHTS中提取热销产品关键词
- 从REAL USE CASES中提取场景关键词
- 示例: "home cleaning robot", "office vacuum", "smart home device"

**🔥 v4.4 产品特性关键词**:
- 从PRODUCT FEATURES中提取核心功能词作为关键词
- 确保覆盖产品的主要卖点和功能
- 示例: "5 in 1 robot vacuum", "ultra slim vacuum", "8000pa suction"

**第一优先级 - 品牌短尾词 (必须生成8-10个)**
**第二优先级 - 产品核心词 (必须生成6-8个)**
**第三优先级 - 购买意图词 (必须生成3-5个)**
**第四优先级 - 长尾精准词 (必须生成3-7个)**

{{exclude_keywords_section}}

### CALLOUTS (4-6, ≤25 chars)
{{callout_guidance}}

### SITELINKS (6): text≤25, desc≤35, url="/" (auto-replaced)
- **REQUIREMENT**: Each sitelink must have a UNIQUE, compelling description
- Focus on different product features, benefits, or use cases

## FORBIDDEN CONTENT:
**❌ Prohibited Words**: "100%", "best", "guarantee", "miracle", ALL CAPS abuse
**❌ Prohibited Symbols (Google Ads Policy)**: ★ ☆ ⭐ 🌟 ✨ © ® ™ • ● ◆ ▪ → ← ↑ ↓ ✓ ✔ ✗ ✘ ❤ ♥ ⚡ 🔥 💎 👍 👎
**❌ Excessive Punctuation**: "!!!", "???", "...", repeated exclamation marks

## OUTPUT (JSON only, no markdown):
{
  "headlines": [{"text":"...", "type":"brand|feature|promo|cta|urgency|social_proof|store_data", "length":N, "keywords":[], "hasNumber":bool, "hasUrgency":bool, "usesSalesMomentum":bool, "usesProductFeatures":bool, "usesStoreData":bool}...],
  "descriptions": [{"text":"...", "type":"value|cta|feature|proof|store_insight", "length":N, "hasCTA":bool, "keywords":[], "usesSalesMomentum":bool, "usesProductFeatures":bool, "usesStoreData":bool}...],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text":"...", "url":"/", "description":"..."}],
  "theme": "...",
  "quality_metrics": {"headline_diversity_score":N, "keyword_relevance_score":N, "sales_momentum_usage":bool, "product_features_usage":bool, "store_data_usage":bool, "estimated_ad_strength":"EXCELLENT"}
}',
  1,
  CURRENT_TIMESTAMP
);

-- =====================================================
-- Verification
-- =====================================================
SELECT
  prompt_id,
  version,
  name,
  is_active,
  created_at
FROM prompt_versions
WHERE prompt_id IN ('brand_analysis_store', 'ad_creative_generation')
ORDER BY prompt_id, created_at DESC;
