-- Migration: 041_update_all_prompts_v2.2
-- Description: 批量更新所有Prompt到 v2.2 版本
-- Created: 2025-12-03
-- Version: v2.1 → v2.2
-- Prompts: 12 个


-- ========================================
-- ad_creative_generation: v2.1 → v2.2
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
  'v2.2',
  '广告创意生成',
  '广告创意生成（Promotions促销版）v2.2',
  '基于产品信息、增强关键词、深度评论分析、本地化数据、品牌分析、促销信息等多维数据，生成Google Ads创意文案',
  'src/lib/ad-creative-generator.ts',
  'buildAdCreativePrompt',
  'Google Ads广告创意生成系统（增强版 v2.1）

基于以下产品信息和增强数据，生成高质量的Google Ads创意文案：

产品信息:
- 标题: {title}
- 价格: {price}
- 评分: {rating}
- 评论数: {reviews}

✨ 增强关键词（AI提取 + 基础提取，已合并去重）:
{enhanced_keywords}

✨ 增强产品信息（P0优化）:
- 产品特性: {product_features}
- 产品优势: {product_benefits}
- 使用场景: {product_usecases}

✨ 深度评论分析（P1优化 - 基础 + 增强合并）:
- 用户好评: {common_praises}
- 购买理由: {purchase_reasons}
- 使用场景: {use_cases}
- 用户痛点: {pain_points}
- 情感分析: {sentiment}

🌍 本地化适配（P2优化）:
- 货币: {currency}
- 文化要点: {cultural_notes}
- 本地关键词: {local_keywords}

🎯 品牌分析（P3优化）:
- 品牌定位: {brand_positioning}
- 品牌语调: {brand_voice}
- 主要竞品: {competitors}

🔥 **CRITICAL PROMOTION EMPHASIS**:
{promotion_section}

竞品分析:
{competitor_analysis}

质量评分: {quality_score}/100

请生成:
1. 15个优质广告标题（30字符内）
2. 4个广告描述（90字符内）

要求:
- **【促销优先】如果有促销信息，必须在3-5个标题和2-3个描述中突出促销**
- 使用紧迫感语言（"限时优惠"、"立即购买"、"优惠码"等）
- 充分利用增强数据中的产品特性、用户好评、购买理由
- 体现本地化文化要点和品牌定位
- 突出产品卖点和差异化优势
- 使用高转化关键词（优先使用AI增强关键词）
- 符合Google Ads政策
- 语言自然流畅，符合品牌语调

促销创意示例（如果有促销）:
- Headline: "Get 20% Off - Use Code SAVE20 | {brand}"
- Headline: "{brand} - Limited Time Offer | Shop Now"
- Headline: "Save on {product} - Deal Ends Soon"
- Description: "Shop now and save 20% on your first order with code SAVE20. Limited time offer!"
- Description: "{product} at special price. Use code SAVE20 for 20% off. Free shipping available."
- Callout: "20% Off with Code SAVE20"
- Callout: "Limited Time Deal"',
  'Chinese',
  1,
  '
v2.2 更新内容:
1. 批量更新所有Prompt到v2.2
2. 从开发环境数据库导出最新Prompt内容
'
);


-- ========================================
-- ad_elements_descriptions: v2.0 → v2.2
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
  'v2.2',
  '广告创意生成',
  '广告描述生成v2.2',
  '支持完整模板变量、评论洞察、促销信息、行动号召',
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

=== REVIEW INSIGHTS ===
Customer Praises: {{reviewPositives}}
Purchase Reasons: {{purchaseReasons}}

=== PROMOTIONS (if active) ===
{{promotionInfo}}

=== TASK ===
Generate 4 Google Search ad descriptions (max 90 characters each).

=== DESCRIPTION STRATEGY ===

**Description 1: Feature + Benefit**
- Lead with strongest product feature
- Connect to customer benefit
- Example: "4K Ultra HD camera captures every detail. See your home clearly day or night."

**Description 2: Social Proof + Trust**
- Use review insights authentically
- Build credibility
- Example: "Trusted by 10,000+ homeowners. 4.8★ rated for reliability and ease of use."

**Description 3: Promotion / Urgency**
- Include active promotions if available
- Create urgency when appropriate
- Example: "Save 20% this week only. Free shipping + 30-day returns included."

**Description 4: Call-to-Action**
- Strong action-oriented language
- Emphasize value proposition
- Example: "Shop now for professional-grade security. Easy setup in minutes."

=== RULES ===
1. Each description MUST be <= 90 characters (including spaces)
2. Include at least one call-to-action per description
3. Use active voice and present tense
4. Avoid generic phrases - be specific to product
5. Include price/discount when compelling

=== OUTPUT FORMAT ===
Return JSON:
{
  "descriptions": ["description1", "description2", "description3", "description4"],
  "descriptionTypes": ["feature", "social_proof", "promotion", "cta"]
}',
  'Chinese',
  1,
  '
v2.2 更新内容:
1. 批量更新所有Prompt到v2.2
2. 从开发环境数据库导出最新Prompt内容
'
);


-- ========================================
-- ad_elements_headlines: v2.0 → v2.2
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
  'v2.2',
  '广告创意生成',
  '广告标题生成v2.2',
  '支持完整模板变量、评论洞察、促销信息、多语言',
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

=== REVIEW INSIGHTS (for authentic messaging) ===
Customer Praises: {{reviewPositives}}
Use Cases: {{reviewUseCases}}

=== PROMOTIONS (if active) ===
{{promotionInfo}}

=== TASK ===
Generate 15 Google Search ad headlines (max 30 characters each).

=== HEADLINE STRATEGY ===

**Group 1: Brand + Product (3 headlines)**
- Must include brand name
- Include core product type
- Examples: "Reolink 4K Security Camera", "eufy Smart Home Camera"

**Group 2: Keyword-Rich (5 headlines)**
- Incorporate high-volume keywords naturally
- Match search intent
- Examples: "Best Home Security Camera", "Wireless Security Camera"

**Group 3: Feature-Focused (4 headlines)**
- Highlight USPs from product features
- Use specific specs when compelling
- Examples: "4K Ultra HD Resolution", "2-Way Audio Built-In"

**Group 4: Social Proof / Promotion (3 headlines)**
- Use review insights authentically
- Include promotions if active
- Examples: "Rated 4.8/5 by 10K+ Users", "Save 20% - Limited Time"

=== RULES ===
1. Each headline MUST be <= 30 characters (including spaces)
2. Use high-intent language: "Buy", "Shop", "Get", "Save"
3. NO DKI dynamic insertion syntax
4. NO quotation marks in headlines
5. Vary headline styles for RSA optimization

=== OUTPUT FORMAT ===
Return JSON:
{
  "headlines": ["headline1", "headline2", ..., "headline15"],
  "headlineAnalysis": {
    "brandHeadlines": ["indices of brand headlines"],
    "keywordHeadlines": ["indices of keyword headlines"],
    "featureHeadlines": ["indices of feature headlines"],
    "proofHeadlines": ["indices of proof/promo headlines"]
  }
}',
  'Chinese',
  1,
  '
v2.2 更新内容:
1. 批量更新所有Prompt到v2.2
2. 从开发环境数据库导出最新Prompt内容
'
);


-- ========================================
-- brand_analysis_store: v2.0 → v2.2
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
  'v2.2',
  '品牌分析',
  '品牌店铺分析v2.2',
  '支持模板变量替换，增强热门产品和品牌定位分析',
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

=== ANALYSIS METHODOLOGY ===

Hot Score Formula: Rating × log10(Review Count + 1)
- 🔥 TOP 5 HOT-SELLING = highest scores (proven winners)
- ✅ Other best sellers = good performers

=== ANALYSIS PRIORITIES ===

1. **Hot Products Analysis** (TOP 5 by Hot Score):
   - Product names and categories
   - Price points and positioning
   - Review scores and volume
   - Why these products succeed

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
      "price": ".XX",
      "rating": 4.5,
      "reviewCount": 1234,
      "hotScore": 3.87,
      "successFactors": ["Factor 1", "Factor 2"]
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
v2.2 更新内容:
1. 批量更新所有Prompt到v2.2
2. 从开发环境数据库导出最新Prompt内容
'
);


-- ========================================
-- brand_name_extraction: v1.0 → v2.2
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
  'v2.2',
  '品牌分析',
  '品牌名称提取v2.2',
  '从产品信息中提取准确的品牌名称',
  'src/lib/ai.ts',
  'extractBrandWithAI',
  'You are a brand name extraction expert. Extract the brand name from product information.

RULES:
1. Return ONLY the brand name
2. 2-30 characters
3. Primary brand only
4. Remove "Store", "Official", "Shop"
5. Extract from title if uncertain

Examples:
- "Reolink 4K Security Camera" → "Reolink"
- "BAGSMART Store" → "BAGSMART"

Output: Brand name only, no explanation.',
  'Chinese',
  1,
  '
v2.2 更新内容:
1. 批量更新所有Prompt到v2.2
2. 从开发环境数据库导出最新Prompt内容
'
);


-- ========================================
-- competitor_analysis: v2.0 → v2.2
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
  'v2.2',
  '竞品分析',
  '竞品分析v2.2',
  '支持完整模板变量、详细竞争力评分、战略建议',
  'src/lib/competitor-analyzer.ts',
  'analyzeCompetitorsWithAI',
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

For each competitor, analyze:

1. **Product Identification**:
   - Brand name
   - Product model/name
   - Price and currency

2. **Quality Metrics**:
   - Star rating
   - Review count
   - Key features
   - Unique selling points (USPs)

3. **Competitiveness Scoring** (0-100):
   - Price competitiveness (30%): Lower = more competitive
   - Feature parity (30%): More features = higher score
   - Social proof (20%): Better ratings/reviews = higher
   - Brand strength (20%): Recognition and trust factors

4. **Threat Assessment**:
   - Direct competitor vs indirect
   - Market overlap percentage
   - Differentiation gap

=== OUTPUT FORMAT ===
Return JSON:
{
  "competitors": [
    {
      "brand": "Brand Name",
      "model": "Product Model",
      "price": 299.99,
      "currency": "USD",
      "rating": 4.5,
      "reviewCount": 1234,
      "keyFeatures": ["feature1", "feature2", "feature3"],
      "usps": ["usp1", "usp2"],
      "competitivenessScore": 85,
      "scoreBreakdown": {
        "priceScore": 25,
        "featureScore": 28,
        "socialProofScore": 18,
        "brandScore": 14
      },
      "threatLevel": "High|Medium|Low",
      "differentiationGaps": ["gap1", "gap2"]
    }
  ],
  "overallAnalysis": {
    "ourPosition": "market_leader|challenger|follower|niche",
    "marketPositionScore": 75,
    "strengthsVsCompetitors": ["strength1", "strength2"],
    "weaknessesVsCompetitors": ["weakness1", "weakness2"],
    "opportunityGaps": ["opportunity1", "opportunity2"],
    "competitiveThreats": ["threat1", "threat2"]
  },
  "strategicRecommendations": {
    "pricing": "Pricing strategy recommendation",
    "positioning": "Positioning strategy recommendation",
    "messaging": "Ad messaging recommendations",
    "keywords": ["competitor keyword 1", "competitor keyword 2"]
  }
}',
  'Chinese',
  1,
  '
v2.2 更新内容:
1. 批量更新所有Prompt到v2.2
2. 从开发环境数据库导出最新Prompt内容
'
);


-- ========================================
-- competitor_keyword_inference: v2.0 → v2.2
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
  'v2.2',
  '竞品分析',
  '竞品搜索关键词推断v2.2',
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
v2.2 更新内容:
1. 批量更新所有Prompt到v2.2
2. 从开发环境数据库导出最新Prompt内容
'
);


-- ========================================
-- creative_quality_scoring: v2.0 → v2.2
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'creative_quality_scoring' AND is_active = 1;

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
  'creative_quality_scoring',
  'v2.2',
  '广告创意生成',
  '广告创意质量评分v2.2',
  '支持完整模板变量、详细评分细项、改进建议',
  'src/lib/scoring.ts',
  'calculateCreativeQualityScore',
  'You are a Google Ads creative quality evaluator.

=== CREATIVE TO EVALUATE ===
Headline: {{headline}}
Description: {{description}}
Brand: {{brand}}
Product: {{productName}}
Target Country: {{targetCountry}}

=== EVALUATION CRITERIA (Total 100 points) ===

**1. Headline Quality (40 points)**
- Attractiveness & Hook (0-15): Does it grab attention?
- Length Compliance (0-10): Within 30 chars, optimal length?
- Differentiation (0-10): Unique vs generic?
- Keyword Naturalness (0-5): Keywords flow naturally?

**2. Description Quality (30 points)**
- Persuasiveness (0-15): Compelling value proposition?
- Length Compliance (0-10): Within 90 chars, well-utilized?
- Call-to-Action (0-5): Clear action for user?

**3. Overall Appeal (20 points)**
- Brand Alignment (0-10): Matches brand voice?
- Interest Generation (0-10): Makes user want to click?

**4. Policy Compliance (10 points)**
- No Exaggeration (0-5): Avoids superlatives, false claims?
- Google Ads Policy (0-5): Compliant with ad policies?

=== OUTPUT FORMAT ===
Return JSON:
{
  "totalScore": 85,
  "breakdown": {
    "headlineQuality": {
      "score": 35,
      "maxScore": 40,
      "details": {
        "attractiveness": 13,
        "lengthCompliance": 9,
        "differentiation": 8,
        "keywordNaturalness": 5
      }
    },
    "descriptionQuality": {
      "score": 26,
      "maxScore": 30,
      "details": {
        "persuasiveness": 13,
        "lengthCompliance": 8,
        "callToAction": 5
      }
    },
    "overallAppeal": {
      "score": 17,
      "maxScore": 20,
      "details": {
        "brandAlignment": 9,
        "interestGeneration": 8
      }
    },
    "policyCompliance": {
      "score": 7,
      "maxScore": 10,
      "details": {
        "noExaggeration": 4,
        "policyCompliant": 3
      }
    }
  },
  "strengths": ["strength1", "strength2"],
  "improvements": [
    {"area": "Headline", "issue": "Too generic", "suggestion": "Add specific feature"}
  ],
  "grade": "A|B|C|D|F"
}',
  'Chinese',
  1,
  '
v2.2 更新内容:
1. 批量更新所有Prompt到v2.2
2. 从开发环境数据库导出最新Prompt内容
'
);


-- ========================================
-- keywords_generation: v2.0 → v2.2
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'keywords_generation' AND is_active = 1;

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
  'keywords_generation',
  'v2.2',
  '关键词生成',
  '关键词生成v2.2',
  '支持模板变量、产品特性、评论洞察、多语言市场定位',
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
   - "[product] reviews"
   - "buy [product]"
   - "[product] deals"

5. **Long-tail Keywords** (3-5 keywords):
   - Specific use case queries
   - Problem-solution queries
   - Comparison queries

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
  "negativeKeywords": [
    {"keyword": "free", "reason": "Excludes non-buyers"},
    {"keyword": "DIY", "reason": "Excludes DIY audience"}
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
}',
  'Chinese',
  1,
  '
v2.2 更新内容:
1. 批量更新所有Prompt到v2.2
2. 从开发环境数据库导出最新Prompt内容
'
);


-- ========================================
-- launch_score_evaluation: v2.0 → v2.2
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'launch_score_evaluation' AND is_active = 1;

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
  'launch_score_evaluation',
  'v2.2',
  '投放评分',
  'Launch Score评估v2.2',
  '支持完整模板变量、详细评分细项、具体改进建议',
  'src/lib/scoring.ts',
  'createLaunchScore',
  'You are a professional Google Ads campaign launch evaluator.

=== CAMPAIGN OVERVIEW ===
Brand: {{brand}}
Product: {{productName}}
Target Country: {{targetCountry}}
Campaign Budget: {{budget}}

=== KEYWORDS DATA ===
Total Keywords: {{keywordCount}}
Match Type Distribution: {{matchTypeDistribution}}
Keywords List:
{{keywordsList}}

Negative Keywords: {{negativeKeywords}}

=== LANDING PAGE ===
URL: {{landingPageUrl}}
Page Type: {{pageType}}

=== AD CREATIVES ===
Headlines Count: {{headlineCount}}
Descriptions Count: {{descriptionCount}}
Sample Headlines: {{sampleHeadlines}}
Sample Descriptions: {{sampleDescriptions}}

=== EVALUATION TASK ===

Score this campaign launch readiness across 5 dimensions (total 100 points):

**1. Keyword Quality (30 points)**
- Relevance to product (0-10)
- Match type strategy (0-8)
- Negative keywords coverage (0-7)
- Search intent alignment (0-5)

IMPORTANT RULES:
- Negative keywords MUST be checked
- Missing negative keywords = deduct 5-10 points
- Competition level is reference only, do NOT deduct points

**2. Market Fit (25 points)**
- Target country alignment (0-10)
- Language/localization (0-8)
- Audience targeting potential (0-7)

IMPORTANT RULES:
- Cross-border domains (amazon.ca, amazon.co.uk) are NORMAL
- Do NOT deduct points for cross-border e-commerce URLs

**3. Landing Page Quality (20 points)**
- URL trustworthiness (0-8)
- Expected load speed (0-6)
- Mobile optimization likelihood (0-6)

**4. Budget Reasonability (15 points)**
- CPC alignment with industry (0-6)
- Competition vs budget match (0-5)
- ROI potential (0-4)

**5. Creative Quality (10 points)**
- Headline attractiveness (0-4)
- Description persuasiveness (0-3)
- Uniqueness and differentiation (0-3)

=== OUTPUT FORMAT ===
Return JSON:
{
  "totalScore": 85,
  "grade": "A|B|C|D|F",
  "dimensions": {
    "keywordQuality": {
      "score": 25,
      "maxScore": 30,
      "breakdown": {
        "relevance": 8,
        "matchTypeStrategy": 7,
        "negativeKeywords": 5,
        "intentAlignment": 5
      },
      "issues": ["issue1", "issue2"],
      "suggestions": ["suggestion1", "suggestion2"]
    },
    "marketFit": {
      "score": 22,
      "maxScore": 25,
      "breakdown": {
        "countryAlignment": 9,
        "localization": 7,
        "audienceTargeting": 6
      },
      "issues": [],
      "suggestions": ["suggestion1"]
    },
    "landingPageQuality": {
      "score": 18,
      "maxScore": 20,
      "breakdown": {
        "urlTrust": 8,
        "loadSpeed": 5,
        "mobileOptimization": 5
      },
      "issues": [],
      "suggestions": []
    },
    "budgetReasonability": {
      "score": 12,
      "maxScore": 15,
      "breakdown": {
        "cpcAlignment": 5,
        "competitionMatch": 4,
        "roiPotential": 3
      },
      "issues": [],
      "suggestions": ["suggestion1"]
    },
    "creativeQuality": {
      "score": 8,
      "maxScore": 10,
      "breakdown": {
        "headlineAttractiveness": 3,
        "descriptionPersuasiveness": 3,
        "uniqueness": 2
      },
      "issues": [],
      "suggestions": ["suggestion1"]
    }
  },
  "topIssues": [
    {"issue": "Critical issue description", "impact": "High", "fix": "How to fix"}
  ],
  "launchRecommendation": {
    "readyToLaunch": true,
    "confidence": "High|Medium|Low",
    "criticalBlockers": [],
    "prelaunchChecklist": ["item1", "item2"]
  }
}',
  'Chinese',
  1,
  '
v2.2 更新内容:
1. 批量更新所有Prompt到v2.2
2. 从开发环境数据库导出最新Prompt内容
'
);


-- ========================================
-- product_analysis_single: v2.0 → v2.2
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
  'v2.2',
  '产品分析',
  '单品产品分析v2.2',
  '支持完整产品数据分析：features、technicalDetails、pricing、reviews、promotions等',
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

2. **Technical Analysis** (from TECHNICAL DETAILS):
   - Key specifications
   - Dimensions and compatibility
   - Material and build quality
   - Technical advantages

3. **Pricing Intelligence** (from Price data):
   - Current vs Original price
   - Discount percentage
   - Price competitiveness assessment
   - Value proposition

4. **Review Insights** (from Rating, Review Count, Review Highlights):
   - Overall sentiment
   - Key positives customers mention
   - Common concerns or issues
   - Real use cases from reviews

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
  "productDescription": "Detailed product description",
  "sellingPoints": ["USP 1", "USP 2", "USP 3"],
  "targetAudience": "Description of ideal customers",
  "category": "Product category",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "pricing": {
    "current": ".XX",
    "original": ".XX or null",
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
  "technicalHighlights": ["Key spec 1", "Key spec 2", "Key spec 3"]
}',
  'Chinese',
  1,
  '
v2.2 更新内容:
1. 批量更新所有Prompt到v2.2
2. 从开发环境数据库导出最新Prompt内容
'
);


-- ========================================
-- review_analysis: v2.0 → v2.2
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
  'v2.2',
  '评论分析',
  '评论分析v2.2',
  '支持模板变量、增强情感分析、购买动机和用户画像分析',
  'src/lib/review-analyzer.ts',
  'analyzeReviewsWithAI',
  'You are an expert e-commerce review analyst. Analyze the following product reviews comprehensively.

=== INPUT DATA ===
Product Name: {{productName}}
Total Reviews: {{totalReviews}}
Target Language: {{langName}}

=== REVIEWS DATA ===
{{reviewTexts}}

=== ANALYSIS REQUIREMENTS ===

Perform deep analysis across these dimensions:

1. **Sentiment Distribution** (Quantitative):
   - Calculate percentage: positive / neutral / negative
   - Identify sentiment patterns by star rating

2. **Positive Keywords** (Top 10):
   - Extract most frequently praised aspects
   - Include specific features customers love
   - Note emotional language patterns

3. **Negative Keywords** (Top 10):
   - Extract most common complaints
   - Identify recurring issues
   - Note severity levels

4. **Real Use Cases** (5-8 scenarios):
   - How customers actually use the product
   - Unexpected use cases discovered
   - Environment/context of usage

5. **Purchase Reasons** (Top 5):
   - Why customers chose this product
   - Decision factors mentioned
   - Comparison with alternatives

6. **User Profiles** (3-5 types):
   - Demographics (if mentioned)
   - Experience levels
   - Primary needs/goals

7. **Common Pain Points** (Top 5):
   - Issues that affect satisfaction
   - Setup/usage difficulties
   - Quality concerns

=== OUTPUT LANGUAGE ===
All output MUST be in {{langName}}.

=== OUTPUT FORMAT ===
Return a COMPLETE JSON object:
{
  "sentimentDistribution": {
    "positive": 70,
    "neutral": 20,
    "negative": 10
  },
  "topPositiveKeywords": [
    {"keyword": "easy to use", "frequency": 45, "context": "setup and daily operation"},
    {"keyword": "great value", "frequency": 38, "context": "price-quality ratio"}
  ],
  "topNegativeKeywords": [
    {"keyword": "battery life", "frequency": 12, "context": "shorter than expected"},
    {"keyword": "instructions unclear", "frequency": 8, "context": "initial setup"}
  ],
  "realUseCases": [
    {"scenario": "Home security monitoring", "frequency": "High", "satisfaction": "Positive"},
    {"scenario": "Baby room monitoring", "frequency": "Medium", "satisfaction": "Positive"}
  ],
  "purchaseReasons": [
    {"reason": "Brand reputation", "frequency": 25},
    {"reason": "Feature set vs price", "frequency": 22}
  ],
  "userProfiles": [
    {"type": "Tech-savvy homeowner", "percentage": 40, "primaryNeed": "Security"},
    {"type": "First-time buyer", "percentage": 30, "primaryNeed": "Ease of use"}
  ],
  "commonPainPoints": [
    {"issue": "WiFi connectivity issues", "severity": "Medium", "frequency": 15},
    {"issue": "App crashes occasionally", "severity": "Low", "frequency": 8}
  ],
  "overallInsights": {
    "productStrength": "Summary of main strengths",
    "improvementAreas": "Summary of areas to improve",
    "marketingAngles": ["Angle 1 for ads", "Angle 2 for ads"]
  }
}',
  'Chinese',
  1,
  '
v2.2 更新内容:
1. 批量更新所有Prompt到v2.2
2. 从开发环境数据库导出最新Prompt内容
'
);

