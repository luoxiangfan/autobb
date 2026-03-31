-- ============================================================================
-- Migration 067: Fix prompt templates missing variables + optimize instructions
-- ============================================================================
--
-- 问题描述:
--   多个prompt模板中缺少变量占位符，导致代码准备的数据无法传递给AI，
--   影响生成内容的质量和相关性
--
-- 修复内容:
--   1. brand_name_extraction v3.1 → v3.2: 添加4个输入变量 + 提取策略指导
--   2. ad_elements_headlines v3.3 → v3.4: 添加4个深度分析变量 + 使用优先级指导
--   3. brand_analysis_store v3.2 → v3.4: 添加2个数据变量 + 使用指导
--
-- 日期: 2025-12-14
-- ============================================================================

-- ============================================================================
-- PART 1: brand_name_extraction v3.1 → v3.2
-- 添加: {{pageData.url}}, {{pageData.title}}, {{pageData.description}}, {{pageData.textPreview}}
-- 优化: 增加提取策略指导（URL/Title/Description/Content优先级）
-- ============================================================================

UPDATE prompt_versions
SET
  version = 'v3.2',
  name = '品牌名称提取v3.2',
  prompt_content = 'You are a brand name extraction expert. Extract the brand name from product information.

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
  change_notes = 'v3.2: 添加输入数据变量并增强提取策略指导'
WHERE prompt_id = 'brand_name_extraction' AND is_active = 1;

-- ============================================================================
-- PART 2: ad_elements_headlines v3.3 → v3.4
-- 添加: {{product.uniqueSellingPoints}}, {{product.targetAudience}},
--       {{product.productHighlights}}, {{product.brandDescription}}
-- 优化: 增加深度分析数据使用优先级指导
-- ============================================================================

UPDATE prompt_versions
SET
  version = 'v3.4',
  name = '广告标题生成v3.4 - CTR优化增强版',
  prompt_content = 'You are a professional Google Ads copywriter specializing in high-CTR headlines.

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
    "uspUsed": true,
    "audienceTargeted": true,
    "highlightsIncluded": true
  }
}',
  change_notes = 'v3.4: 添加深度分析变量并增强使用指导，确保AI优先利用USP/Audience/Highlights数据'
WHERE prompt_id = 'ad_elements_headlines' AND is_active = 1;

-- ============================================================================
-- PART 3: brand_analysis_store v3.2 → v3.4
-- 添加: {{technicalDetails}}, {{reviewHighlights}}
-- 优化: 增加数据使用指导
-- ============================================================================

UPDATE prompt_versions
SET
  version = 'v3.4',
  name = '品牌店铺分析v3.4',
  prompt_content = 'You are a professional brand analyst. Analyze the BRAND STORE PAGE data and extract comprehensive brand information.

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
   - Amazon Choice badges
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
      "price": ".XX",
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
  change_notes = 'v3.4: 添加technicalDetails/reviewHighlights变量并增强使用指导'
WHERE prompt_id = 'brand_analysis_store' AND is_active = 1;
