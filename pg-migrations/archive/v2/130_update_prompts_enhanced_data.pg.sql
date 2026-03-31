-- ============================================================
-- Migration: 130_update_prompts_enhanced_data.pg.sql
-- Description: 整合迁移 - 更新6个Prompts到v4.15/v4.16版本
--              新增独立站增强数据字段支持（reviews、faqs、specifications等）
--
-- 整合自以下迁移文件：
--   - 130_update_prompt_v4.16.pg.sql (product_analysis_single)
--   - 131_update_ad_creative_prompt_v4.33.pg.sql (ad_creative_generation)
--   - 132_update_brand_analysis_store_prompt_v4.16.pg.sql (brand_analysis_store)
--   - 133_update_ad_elements_descriptions_prompt_v4.15.pg.sql (ad_elements_descriptions)
--   - 134_update_ad_elements_headlines_prompt_v4.15.pg.sql (ad_elements_headlines)
--   - 135_update_store_highlights_synthesis_prompt_v4.15.pg.sql (store_highlights_synthesis)
--
-- Author: Claude Code
-- Date: 2026-01-04
-- Database: PostgreSQL
-- ============================================================

-- ============================================================
-- Part 1: product_analysis_single → v4.16
-- ============================================================

-- 幂等性保证：先删除v4.16版本（如果存在）
DELETE FROM prompt_versions
WHERE prompt_id = 'product_analysis_single'
AND version = 'v4.16';

-- 停用旧版本v4.15
UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'product_analysis_single'
AND version = 'v4.15';

-- 插入新版本v4.16
INSERT INTO prompt_versions (
  prompt_id, version, category, name, description, file_path, function_name,
  prompt_content, language, created_by, is_active, change_notes
) VALUES (
  'product_analysis_single',
  'v4.16',
  '产品分析',
  '单品产品分析v4.16',
  '增强版单品产品分析Prompt，新增独立站增强数据字段支持',
  'src/lib/ai.ts',
  'analyzeProductPage',
  $PROMPT$You are a professional product analyst. Analyze the following product page data comprehensively.

=== INPUT DATA ===
URL: {{pageData.url}}
Brand: {{pageData.brand}}
Title: {{pageData.title}}
Description: {{pageData.description}}

=== FULL PAGE DATA ===
{{pageData.text}}

=== 🎯 ENHANCED DATA (P1 Optimization) ===
**Technical Specifications**: {{technicalDetails}}
**Review Highlights**: {{reviewHighlights}}

=== 🔥 INDEPENDENT STORE ENHANCED DATA (v4.16 New) ===
**User Reviews**: {{reviews}}
- Use reviews to identify real customer pain points and needs
- Extract authentic use cases and satisfaction indicators

**Frequently Asked Questions**: {{faqs}}
- Understand what customers care about most
- Use FAQs to address potential objections

**Product Specifications**: {{specifications}}
- Use for technical differentiation analysis

**Package Options**: {{packages}}
- Analyze pricing tiers and value propositions

**Social Proof**: {{socialProof}}
- Use metrics like "18,000+ Installations" for competitive positioning

**Core Features**: {{coreFeatures}}
- These are the main value propositions

**Secondary Features**: {{secondaryFeatures}}
- Use to round out the value proposition

=== ANALYSIS REQUIREMENTS ===
CRITICAL: Focus ONLY on the MAIN PRODUCT. IGNORE:
- "Customers also bought", "Frequently bought together", "Related products"

Analyze these dimensions:
1. **Product Core** - Name, USPs, core features, target use cases
2. **Technical Analysis** - Key specifications, dimensions, material quality
3. **Pricing Intelligence** - Current vs Original price, discount, value proposition
4. **Review Insights** - Sentiment, positives, concerns, real use cases
5. **Customer Intent Analysis** - Use FAQs to understand concerns
6. **Market Position** - Category ranking, badges, social proof

=== OUTPUT LANGUAGE ===
All output MUST be in {{langName}}.

=== OUTPUT FORMAT ===
Return COMPLETE JSON:
{
  "productDescription": "Detailed description emphasizing technical specs and reviews",
  "sellingPoints": ["USP 1", "USP 2", "USP 3", "USP 4"],
  "targetAudience": "Customer description based on use cases",
  "category": "Product category",
  "keywords": ["keyword1", "keyword2", ...],
  "pricing": {
    "current": "$.XX",
    "original": "$.XX or null",
    "discount": "XX% or null",
    "competitiveness": "Premium/Competitive/Budget"
  },
  "reviews": {
    "rating": 4.5,
    "count": 1234,
    "sentiment": "Positive/Mixed/Negative",
    "positives": ["Pro 1", "Pro 2"],
    "concerns": ["Con 1", "Con 2"],
    "useCases": ["Use case 1", "Use case 2"]
  },
  "competitiveEdges": {
    "badges": ["Amazon's Choice"],
    "socialProof": ["18,000+ Installations"]
  },
  "productHighlights": ["Key spec 1", "Key spec 2", "Key spec 3"]
}

=== IMPORTANT NOTES ===
- 🔥 Leverage User Reviews, FAQs, and Social Proof data for deeper insights
- 🔥 Prioritize customer-validated features over marketing claims$PROMPT$,
  'English',
  1,
  true,
  'v4.16: 新增独立站增强数据字段支持（reviews、faqs、specifications、packages、socialProof、coreFeatures、secondaryFeatures）'
);

-- ============================================================
-- Part 2: ad_creative_generation → v4.33
-- ============================================================

DELETE FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
AND version = 'v4.33';

UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'ad_creative_generation'
AND version = 'v4.32';

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description, file_path, function_name,
  prompt_content, language, created_by, is_active, change_notes
) VALUES (
  'ad_creative_generation',
  'v4.33',
  '广告创意生成',
  '广告创意生成v4.33 - 独立站增强数据支持',
  '增强版广告创意生成Prompt，新增独立站增强数据字段支持',
  'src/lib/ad-creative-generator.ts',
  'generateAdCreative',
  $PROMPT$You are a professional Google Ads copywriter. Generate high-converting Responsive Search Ads.

=== OUTPUT FORMAT ===
JSON with 15 headlines (≤30 chars), 4 descriptions (≤90 chars), 15 keywords, 6 callouts (≤25 chars), 6 sitelinks (text≤25, desc≤35).

=== INPUT DATA ===
PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}

=== 🔥 INDEPENDENT STORE ENHANCED DATA（v4.33新增）===
{{extras_data}}

=== HEADLINE STRUCTURE: 2+4+4+2+3 (15 total) ===

**Group 1 - Brand (2)**: Include brand and product name
- Use {KeyWord:brand} for first headline
- Example: "{KeyWord:Roborock} Official"

**Group 2 - Features (4)**: Highlight technical specs
- 🔥 Use TECH SPECS and CORE FEATURES
- Include numbers: "25000 Pa Suction"

**Group 3 - Benefits (4)**: User benefits
- 🔥 Use USER PRAISES and SOCIAL PROOF METRICS
- Example: "5000+ Happy Customers"

**Group 4 - Questions (2)**: Address pain points
- 🔥 Use CUSTOMER FAQs and REAL USER REVIEWS
- Must end with "?"

**Group 5 - Urgency (3)**: Competitive/urgent
- 🔥 Use SOCIAL PROOF METRICS
- Include "Limited Time" or metrics

=== DESCRIPTION STRUCTURE: 2+1+1 (4 total) ===

**Template 1 - Feature+Benefit+CTA**: Use {{coreFeatures}} and {{techSpecs}}
**Template 2 - Problem+Solution+Proof**: Address {{customerFaqs}}, use {{realUserReviews}}
**Template 3 - Offer+Urgency+Trust**: Use {{promotionInfo}} and {{socialProofMetrics}}
**Template 4 - USP+Differentiation**: Highlight unique advantages

Each description MUST end with: Shop Now / Buy Now / Get Yours / Order Now / Learn More

=== CALLOUTS (2+2+2) ===
**Trust Signals (2)**: 🔥 Use {{socialProofMetrics}} - "18,000+ Users"
**Promotions (2)**: "Free Shipping", "Limited Time -23%"
**Features (2)**: 🔥 Use {{techSpecs}} - "25000Pa Suction"

=== SITELINKS (2+2+2) ===
**Products (2)**: 🔥 Use {{packageOptions}} - "Qrevo Curv 2 Pro"
**Brand (2)**: "Roborock Vacuums"
**Use Cases (2)**: 🔥 Use {{customerFaqs}} - "Pet Hair Solution"

=== RULES ===
1. Headlines ≤30 chars, Descriptions ≤90 chars
2. 2 question headlines (end with "?")
3. 1 urgency headline (Limited/Today/Now)
4. Brand word coverage: 3-4/15 (20-27%)
5. All descriptions with English CTA
6. 🔥 Leverage all enhanced data from {{extras_data}}$PROMPT$,
  'English',
  1,
  true,
  'v4.33: 新增独立站增强数据字段支持（REAL USER REVIEWS、CUSTOMER FAQs、TECH SPECS、PACKAGE OPTIONS、SOCIAL PROOF METRICS、CORE FEATURES）'
);

-- ============================================================
-- Part 3: brand_analysis_store → v4.16
-- ============================================================

DELETE FROM prompt_versions
WHERE prompt_id = 'brand_analysis_store'
AND version = 'v4.16';

UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'brand_analysis_store'
AND version = 'v4.15';

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description, file_path, function_name,
  prompt_content, language, created_by, is_active, change_notes
) VALUES (
  'brand_analysis_store',
  'v4.16',
  '品牌分析',
  '品牌店铺分析v4.16 - 独立站增强数据支持',
  '增强版品牌店铺分析Prompt，新增独立站增强数据字段支持',
  'src/lib/ai.ts',
  'analyzeBrandStore',
  $PROMPT$You are a professional brand analyst. Analyze the BRAND STORE PAGE data.

=== INPUT DATA ===
URL: {{pageData.url}}
Brand: {{pageData.brand}}
Title: {{pageData.title}}
Description: {{pageData.description}}

=== STORE PRODUCTS DATA ===
{{pageData.text}}

=== 🔥 INDEPENDENT STORE ENHANCED DATA（v4.16 New）===
User Reviews: {{reviews}}
FAQs: {{faqs}}
Tech Specs: {{specifications}}
Social Proof: {{socialProof}}
Core Features: {{coreFeatures}}

⚠️ USE THIS DATA: If available, incorporate into your analysis.

=== ANALYSIS PRIORITIES ===
1. Hot Products Analysis - Use {{technicalDetails}} and {{coreFeatures}}
2. Brand Positioning - Validate with {{socialProof}} metrics
3. Target Audience - Use {{faqs}} to understand concerns
4. Value Proposition - Validate with {{reviews}}
5. Quality Indicators - Customer sentiment from {{reviews}} and {{socialProof}}

=== OUTPUT LANGUAGE ===
All output MUST be in {{langName}}.

=== OUTPUT FORMAT ===
Return COMPLETE JSON with brand analysis and keywords.$PROMPT$,
  'English',
  1,
  true,
  'v4.16: 新增独立站增强数据字段支持（REAL USER REVIEWS、FAQ、TECHNICAL SPECS、SOCIAL PROOF）'
);

-- ============================================================
-- Part 4: ad_elements_descriptions → v4.15
-- ============================================================

DELETE FROM prompt_versions
WHERE prompt_id = 'ad_elements_descriptions'
AND version = 'v4.15';

UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'ad_elements_descriptions'
AND version = 'v4.14';

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description, file_path, function_name,
  prompt_content, language, created_by, is_active, change_notes
) VALUES (
  'ad_elements_descriptions',
  'v4.15',
  '广告创意生成',
  '广告描述生成v4.15 - 独立站增强数据支持',
  '增强版广告描述生成Prompt，新增独立站增强数据字段支持',
  'src/lib/ad-elements-extractor.ts',
  'generateDescriptions',
  $PROMPT$You are a professional Google Ads copywriter. Generate 4 ad descriptions (max 90 chars each).

=== PRODUCT INFO ===
Product: {{productName}}
Brand: {{brand}}
Price: {{price}}
Rating: {{rating}}

=== 🔥 INDEPENDENT STORE ENHANCED DATA（v4.15 New）===
REAL USER REVIEWS: {{realUserReviews}}
CUSTOMER FAQs: {{customerFaqs}}
TECH SPECS: {{techSpecs}}
SOCIAL PROOF METRICS: {{socialProofMetrics}}
CORE FEATURES: {{coreFeatures}}

=== TASK ===
Generate 4 descriptions using these templates:
1. FEATURE-BENEFIT-CTA - Use {{coreFeatures}} and {{techSpecs}}
2. PROBLEM-SOLUTION-PROOF - Address concerns from {{customerFaqs}}, use {{realUserReviews}}
3. OFFER-URGENCY-TRUST - Use {{promotionInfo}} and {{socialProofMetrics}}
4. USP-DIFFERENTIATION - Highlight unique advantages

=== OUTPUT FORMAT ===
Return JSON: { "descriptions": ["d1", "d2", "d3", "d4"], "dataUtilization": { "enhancedDataUsed": true } }$PROMPT$,
  'Chinese',
  1,
  true,
  'v4.15: 新增独立站增强数据字段支持（REAL USER REVIEWS、CUSTOMER FAQs、TECH SPECS、SOCIAL PROOF METRICS）'
);

-- ============================================================
-- Part 5: ad_elements_headlines → v4.15
-- ============================================================

DELETE FROM prompt_versions
WHERE prompt_id = 'ad_elements_headlines'
AND version = 'v4.15';

UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'ad_elements_headlines'
AND version = 'v4.14';

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description, file_path, function_name,
  prompt_content, language, created_by, is_active, change_notes
) VALUES (
  'ad_elements_headlines',
  'v4.15',
  '广告创意生成',
  '广告标题生成v4.15 - 独立站增强数据支持',
  '增强版广告标题生成Prompt，新增独立站增强数据字段支持',
  'src/lib/ad-elements-extractor.ts',
  'generateHeadlines',
  $PROMPT$You are a professional Google Ads copywriter. Generate 15 ad headlines (max 30 chars each).

=== PRODUCT INFO ===
Product: {{product.name}}
Brand: {{product.brand}}
Rating: {{product.rating}}

=== 🔥 INDEPENDENT STORE ENHANCED DATA（v4.15 New）===
REAL USER REVIEWS: {{realUserReviews}}
TECH SPECS: {{techSpecs}}
SOCIAL PROOF METRICS: {{socialProofMetrics}}
CORE FEATURES: {{coreFeatures}}

=== TASK ===
Generate 15 headlines in these groups:
1. Brand + USP (3) - From {{product.uniqueSellingPoints}} and {{coreFeatures}}
2. Keyword + Audience (3) - Combine {{topKeywords}} with {{product.targetAudience}}
3. Feature + Number (3) - From {{product.productHighlights}} and {{techSpecs}}
4. Social Proof (3) - Use {{trustBadges}} and {{socialProofMetrics}}
5. Question + Pain Point (3) - From {{realUserReviews}}

=== OUTPUT FORMAT ===
Return JSON: { "headlines": ["h1", "h2", ...(15)], "dataUtilization": { "enhancedDataUsed": true } }$PROMPT$,
  'Chinese',
  1,
  true,
  'v4.15: 新增独立站增强数据字段支持（REAL USER REVIEWS、TECH SPECS、SOCIAL PROOF METRICS、CORE FEATURES）'
);

-- ============================================================
-- Part 6: store_highlights_synthesis → v4.15
-- ============================================================

DELETE FROM prompt_versions
WHERE prompt_id = 'store_highlights_synthesis'
AND version = 'v4.15';

UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'store_highlights_synthesis'
AND version = 'v4.14';

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description, file_path, function_name,
  prompt_content, language, created_by, is_active, change_notes
) VALUES (
  'store_highlights_synthesis',
  'v4.15',
  '广告创意生成',
  '店铺产品亮点整合v4.15 - 独立站增强数据支持',
  '增强版店铺亮点整合Prompt，新增独立站增强数据字段支持',
  'src/lib/ad-elements-extractor.ts',
  'synthesizeStoreHighlights',
  $PROMPT$You are a product marketing expert. Synthesize product highlights from {{productCount}} products into 5-8 store-level highlights.

=== INPUT: Product Highlights ===
{{productHighlights}}

=== 🔥 INDEPENDENT STORE ENHANCED DATA（v4.15 New）===
STORE CORE FEATURES: {{coreFeatures}}
STORE SOCIAL PROOF METRICS: {{socialProofMetrics}}
STORE REVIEWS: {{storeReviews}}

=== TASK ===
Synthesize into 5-8 store highlights that:
1. Identify common themes and technologies
2. Highlight unique innovations
3. Focus on customer benefits
4. Incorporate {{socialProofMetrics}} for credibility
5. Validate with {{storeReviews}}

=== OUTPUT FORMAT ===
Return JSON: { "storeHighlights": ["h1", "h2", ...], "dataUtilization": { "enhancedDataUsed": true } }

Output in {{langName}}.$PROMPT$,
  'English',
  1,
  true,
  'v4.15: 新增独立站增强数据字段支持（SOCIAL PROOF METRICS、CORE FEATURES、STORE REVIEWS）'
);

-- ============================================================
-- Verification Query
-- ============================================================
-- SELECT prompt_id, version, name, is_active, created_at
-- FROM prompt_versions
-- WHERE prompt_id IN (
--   'product_analysis_single', 'ad_creative_generation', 'brand_analysis_store',
--   'ad_elements_descriptions', 'ad_elements_headlines', 'store_highlights_synthesis'
-- )
-- AND is_active = true
-- ORDER BY prompt_id;
