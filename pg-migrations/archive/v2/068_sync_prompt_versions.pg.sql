-- ============================================================================
-- Migration 068: 同步prompt版本 - 修复065/066覆盖问题
-- ============================================================================
--
-- 问题:
--   065/066合并迁移包含旧版本prompt，重新执行后覆盖了067的新版本
--   - ad_elements_headlines: v3.4 → v3.3 (被覆盖)
--   - brand_analysis_store: v3.4 → v3.2 (被覆盖)
--
-- 修复:
--   1. 将上述prompt升级到本地最新版本
--   2. 清理冗余的旧版本prompt (launch_score_evaluation, creative_quality_scoring)
--
-- 日期: 2025-12-14
-- ============================================================================

-- ============================================================================
-- PART 1: ad_elements_headlines v3.3 → v3.4
-- ============================================================================

UPDATE prompt_versions SET is_active = false
WHERE prompt_id = 'ad_elements_headlines' AND is_active = true;

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, language,
  is_active, change_notes, created_at
) VALUES (
  'ad_elements_headlines',
  'v3.4',
  '广告创意生成',
  '广告标题生成v3.4 - CTR优化增强版',
  'CTR优化增强版：添加深度分析变量（USP/Audience/Highlights），增强使用优先级指导',
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
    "uspUsed": true,
    "audienceTargeted": true,
    "highlightsIncluded": true
  }
}',
  'English',
  true,
  'v3.4: 添加深度分析变量并增强使用指导，确保AI优先利用USP/Audience/Highlights数据',
  NOW()
) ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  name = EXCLUDED.name,
  prompt_content = EXCLUDED.prompt_content,
  change_notes = EXCLUDED.change_notes;

-- ============================================================================
-- PART 2: brand_analysis_store v3.2 → v3.4
-- ============================================================================

UPDATE prompt_versions SET is_active = false
WHERE prompt_id = 'brand_analysis_store' AND is_active = true;

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, language,
  is_active, change_notes, created_at
) VALUES (
  'brand_analysis_store',
  'v3.4',
  '品牌分析',
  '品牌店铺分析v3.4',
  '添加technicalDetails/reviewHighlights变量并增强使用指导',
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
  'English',
  true,
  'v3.4: 添加technicalDetails/reviewHighlights变量并增强使用指导',
  NOW()
) ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  name = EXCLUDED.name,
  prompt_content = EXCLUDED.prompt_content,
  change_notes = EXCLUDED.change_notes;

-- ============================================================================
-- PART 3: 停用冗余的旧版本 prompt
-- ============================================================================

-- 停用 creative_quality_scoring (已被其他方式替代)
UPDATE prompt_versions SET is_active = false
WHERE prompt_id = 'creative_quality_scoring';

-- 停用 launch_score_evaluation (已被 launch_score v4.0 替代)
UPDATE prompt_versions SET is_active = false
WHERE prompt_id = 'launch_score_evaluation';

-- launch_score v4.0 保持激活 (替代了 launch_score_evaluation)
-- 停用 launch_score_v4 (冗余，统一使用 launch_score)
UPDATE prompt_versions SET is_active = false
WHERE prompt_id = 'launch_score_v4';

-- 修复 keywords_generation category
UPDATE prompt_versions SET category = '关键词生成'
WHERE prompt_id = 'keywords_generation';

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- SELECT prompt_id, version, is_active, name FROM prompt_versions
-- WHERE prompt_id IN ('ad_elements_headlines', 'brand_analysis_store',
--                     'creative_quality_scoring', 'launch_score_evaluation', 'launch_score')
-- ORDER BY prompt_id, version DESC;
