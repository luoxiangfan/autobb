-- =====================================================
-- Migration: 066_consolidated_prompt_analysis.sql
-- Description: 合并分析类Prompts（原064-080中的analysis相关）
-- Date: 2025-12-14
--
-- 整合来源:
--   - 064: product_analysis_single v3.2, brand_analysis_store v3.2
--   - 074: review_analysis v3.2, competitor_analysis v3.2
--   - 075: store_highlights_synthesis v1.0
--   - 077: keywords_generation v3.2
--   - 077: launch_score v4.0 (原遗漏)
--
-- 最终版本:
--   - product_analysis_single v3.2 (productHighlights字段修复)
--   - brand_analysis_store v3.2 (productHighlights字段添加)
--   - review_analysis v3.2 (quantitativeHighlights + competitorMentions)
--   - competitor_analysis v3.2 (competitorWeaknesses)
--   - keywords_generation v3.2 (禁止竞品关键词)
--   - store_highlights_synthesis v1.0 (店铺产品亮点整合)
--   - launch_score v4.0 (4维度投放评分体系)
-- =====================================================

-- ============================================================
-- PART 1: product_analysis_single v3.2 (字段修复)
-- ============================================================
-- 修复：将technicalHighlights统一为productHighlights

UPDATE prompt_versions SET is_active = 0
WHERE prompt_id = 'product_analysis_single' AND is_active = 1;

-- 基于v3.1创建v3.2，修复字段名
INSERT OR REPLACE INTO prompt_versions (
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
  1 as is_active,
  '🔧 修复：将AI返回字段从technicalHighlights统一为productHighlights，解决前端显示问题' as change_notes
FROM prompt_versions
WHERE prompt_id = 'product_analysis_single' AND version = 'v3.1';

-- ============================================================
-- PART 2: brand_analysis_store v3.2 (字段添加)
-- ============================================================
-- 为热销商品添加productHighlights字段

UPDATE prompt_versions SET is_active = 0
WHERE prompt_id = 'brand_analysis_store' AND is_active = 1;

-- 基于v3.1创建v3.2，添加productHighlights
INSERT OR REPLACE INTO prompt_versions (
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
  1 as is_active,
  '🔧 增强：为热销商品添加productHighlights字段，与单品分析保持一致' as change_notes
FROM prompt_versions
WHERE prompt_id = 'brand_analysis_store' AND version = 'v3.1';

-- ============================================================
-- PART 3: review_analysis v3.2 (增强数字提取)
-- ============================================================
-- 新增quantitativeHighlights和competitorMentions字段

UPDATE prompt_versions SET is_active = 0 WHERE prompt_id = 'review_analysis';

INSERT OR REPLACE INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, language,
  is_active, change_notes
) VALUES (
  'review_analysis',
  'v3.2',
  '产品分析',
  '评论分析v3.2',
  '评论分析v3.2 - 增强数字提取和竞品提及分析',
  'src/lib/review-analyzer.ts',
  'analyzeReviews',
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

8. **Quantitative Highlights** (NEW - CRITICAL for ads):
   - Extract SPECIFIC NUMBERS mentioned in reviews
   - Battery life: "8 hours", "2-day standby"
   - Power/Performance: "2000Pa suction", "99.9% kill rate"
   - Capacity: "5L tank", "300ml dustbin"
   - Speed: "30-minute charge", "cleans in 45 mins"
   - Coverage: "2000 sq ft", "150m² range"
   - Warranty/Durability: "3-year warranty", "lasted 2 years"
   - These numbers are GOLD for advertising claims!

9. **Competitor Mentions** (NEW):
   - Which competitor brands do customers compare to?
   - How does this product compare? (better/worse/same)
   - This reveals market positioning opportunities

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
  "quantitativeHighlights": [
    {"metric": "Battery Life", "value": "8 hours", "source": "multiple reviews", "adCopy": "8-Hour Battery Life"},
    {"metric": "Suction Power", "value": "2000Pa", "source": "verified purchase", "adCopy": "Powerful 2000Pa Suction"},
    {"metric": "Cleaning Coverage", "value": "2000 sq ft", "source": "5 reviews", "adCopy": "Covers 2000 sq ft"},
    {"metric": "Charging Time", "value": "30 minutes", "source": "multiple mentions", "adCopy": "Fast 30-Min Charge"}
  ],
  "competitorMentions": [
    {"brand": "Roomba", "comparison": "cheaper than", "sentiment": "positive"},
    {"brand": "Dyson", "comparison": "similar quality to", "sentiment": "neutral"}
  ],
  "overallInsights": {
    "productStrength": "Summary of main strengths",
    "improvementAreas": "Summary of areas to improve",
    "marketingAngles": ["Angle 1 for ads", "Angle 2 for ads"]
  }
}',
  'English',
  1,
  'v3.2更新: 1. 新增quantitativeHighlights提取评论中的具体数字 2. 新增competitorMentions追踪用户提及的竞品品牌'
);

-- ============================================================
-- PART 4: competitor_analysis v3.2 (竞品弱点挖掘)
-- ============================================================

UPDATE prompt_versions SET is_active = 0 WHERE prompt_id = 'competitor_analysis';

INSERT OR REPLACE INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, language,
  is_active, change_notes
) VALUES (
  'competitor_analysis',
  'v3.2',
  '产品分析',
  '竞品分析v3.2',
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
      "feature": "Feature name (e.g., ''7000Pa suction power'', ''Auto-empty station'')",
      "weHave": true,
      "competitorsHave": 2,
      "ourAdvantage": true
    }
  ],
  "uniqueSellingPoints": [
    {
      "usp": "Brief unique selling point (e.g., ''Only model with Pro-Detangle Comb technology'')",
      "differentiator": "Detailed explanation of how this differentiates us",
      "competitorCount": 0,
      "significance": "high"
    }
  ],
  "competitorAdvantages": [
    {
      "advantage": "Competitor''s advantage (e.g., ''Lower price point'', ''Higher suction power'')",
      "competitor": "Competitor brand or product name",
      "howToCounter": "Strategic recommendation to counter this advantage"
    }
  ],
  "competitorWeaknesses": [
    {
      "weakness": "Common competitor problem (e.g., ''Short battery life'', ''Difficult app setup'', ''Poor customer support'')",
      "competitor": "Competitor name or ''Multiple competitors'' if widespread",
      "frequency": "high",
      "ourAdvantage": "How our product avoids or solves this problem",
      "adCopy": "Ready-to-use ad copy (e.g., ''8-Hour Battery - Outlasts the Competition'', ''Easy 1-Minute Setup'')"
    }
  ],
  "overallCompetitiveness": 75
}

**Field Guidelines**:

- **featureComparison**: List 3-5 key features. Set "weHave" to true if we have it, "competitorsHave" is count (0-5), "ourAdvantage" is true if we have it but most competitors don''t.

- **uniqueSellingPoints**: List 2-4 USPs. "significance" must be "high", "medium", or "low". Lower "competitorCount" means more unique (0 = only us).

- **competitorAdvantages**: List 1-3 areas where competitors are stronger. Include actionable "howToCounter" strategies.

- **competitorWeaknesses** (NEW): List 2-4 common competitor problems that our product solves better. "frequency" indicates how common this complaint is (high/medium/low). "adCopy" should be a short, punchy phrase ready to use in ads.

- **overallCompetitiveness**: Score 0-100 based on:
  * Price competitiveness (30%): Lower price = higher score
  * Feature superiority (30%): More/better features = higher score
  * Social proof (20%): Better rating/more reviews = higher score
  * Unique differentiation (20%): More USPs = higher score

**Important**: Return ONLY the JSON object, no markdown code blocks, no explanations.',
  'English',
  1,
  'v3.2更新: 新增competitorWeaknesses字段，从竞品常见问题中提取可用于广告的差异化卖点'
);

-- ============================================================
-- PART 5: keywords_generation v3.2 (禁止竞品关键词)
-- ============================================================

UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'keywords_generation' AND is_active = 1;

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
  1,
  '修复关键词冲突：明确禁止生成竞品品牌关键词，避免与否定关键词列表冲突。移除comparison queries类别，只保留自有品牌和通用类别关键词。'
);

-- ============================================================
-- PART 6: store_highlights_synthesis v1.0 (店铺亮点整合)
-- ============================================================

INSERT INTO prompt_versions (prompt_id, version, category, name, description, file_path, function_name, prompt_content, is_active, created_at)
VALUES (
  'store_highlights_synthesis',
  'v1.0',
  '品牌分析',
  '店铺产品亮点整合v1.0',
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
  1,
  datetime('now')
);

-- ============================================================
-- PART 7: launch_score v4.0 (4维度投放评分体系)
-- ============================================================
-- 问题修复：077迁移文件遗漏了此prompt的插入
-- 代码 src/lib/scoring.ts 调用 loadPrompt('launch_score')

INSERT OR REPLACE INTO prompt_versions (
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
  change_notes,
  created_at
) VALUES (
  'launch_score',
  'v4.0',
  '投放评分',
  '投放评分v4.0',
  'Launch Score 4维度评分体系 - 投放可行性/广告质量/关键词策略/基础配置',
  'src/lib/scoring.ts',
  'calculateLaunchScore',
  'You are a professional Google Ads campaign launch evaluator using the NEW 4-DIMENSION scoring system.

=== CAMPAIGN OVERVIEW ===
Brand: {{brand}}
Product: {{productName}}
Target Country: {{targetCountry}}
Target Language: {{targetLanguage}}
Campaign Budget: {{budget}}
Max CPC: {{maxCpc}}

=== PRODUCT ECONOMICS ===
Product Price: {{productPrice}}
Commission Rate: {{commissionRate}}
Profit per Sale: {{profitPerSale}}
Break-even CPC: {{breakEvenCpc}} (based on 50 clicks per conversion)

=== BRAND SEARCH DATA ===
Brand Name: {{brand}}
Brand Search Volume (monthly): {{brandSearchVolume}}
Brand Competition Level: {{brandCompetition}}

=== KEYWORDS DATA ===
Total Keywords: {{keywordCount}}
Match Type Distribution: {{matchTypeDistribution}}
Keywords with Volume:
{{keywordsWithVolume}}

Negative Keywords ({{negativeKeywordsCount}}): {{negativeKeywords}}

=== AD CREATIVES ===
Headlines Count: {{headlineCount}}
Descriptions Count: {{descriptionCount}}
Sample Headlines: {{sampleHeadlines}}
Sample Descriptions: {{sampleDescriptions}}
Headline Diversity: {{headlineDiversity}}%
Ad Strength: {{adStrength}}

=== LANDING PAGE ===
Final URL: {{finalUrl}}
Page Type: {{pageType}}

=== 4-DIMENSION SCORING SYSTEM (Total 100 points) ===

**DIMENSION 1: Launch Viability (35 points)**
Evaluates whether this campaign is worth launching based on market potential and economics.

- Brand Search Volume Score (0-15 points):
  * 0-100 monthly searches: 0-3 points (very low awareness)
  * 100-500 searches: 4-7 points (emerging brand)
  * 500-2000 searches: 8-11 points (established brand)
  * 2000+ searches: 12-15 points (strong brand)

- Profit Margin Score (0-10 points):
  * Compare Break-even CPC vs actual Max CPC
  * If Max CPC < 50% of Break-even: 8-10 points (high margin)
  * If Max CPC = 50-80% of Break-even: 5-7 points (healthy margin)
  * If Max CPC = 80-100% of Break-even: 2-4 points (tight margin)
  * If Max CPC > Break-even: 0-1 points (likely loss)

- Competition Score (0-10 points):
  * LOW competition: 8-10 points
  * MEDIUM competition: 4-7 points
  * HIGH competition: 0-3 points

**DIMENSION 2: Ad Quality (30 points)**
Evaluates the quality and effectiveness of ad creatives.

- Ad Strength Score (0-15 points):
  * POOR: 0-3 points
  * AVERAGE: 4-8 points
  * GOOD: 9-12 points
  * EXCELLENT: 13-15 points

- Headline Diversity Score (0-8 points):
  * Evaluate uniqueness and variety of 15 headlines
  * High diversity (>80%): 7-8 points
  * Medium diversity (50-80%): 4-6 points
  * Low diversity (<50%): 0-3 points

- Description Quality Score (0-7 points):
  * Strong CTA and benefits: 6-7 points
  * Adequate but generic: 3-5 points
  * Weak or missing CTA: 0-2 points

**DIMENSION 3: Keyword Strategy (20 points)**
Evaluates keyword selection and targeting strategy.

- Relevance Score (0-8 points):
  * How well keywords match product/brand
  * High relevance: 7-8 points
  * Medium relevance: 4-6 points
  * Low relevance: 0-3 points

- Match Type Score (0-6 points):
  * Balanced mix of exact/phrase/broad: 5-6 points
  * Mostly one type: 2-4 points
  * Only broad match: 0-1 points

- Negative Keywords Score (0-6 points):
  * Comprehensive negative list (20+): 5-6 points
  * Basic coverage (10-20): 3-4 points
  * Minimal (5-10): 1-2 points
  * None: 0 points (CRITICAL ISSUE)

**DIMENSION 4: Basic Configuration (15 points)**
Evaluates technical setup and configuration.

- Country/Language Match Score (0-5 points):
  * Perfect match: 5 points
  * Minor mismatch: 2-4 points
  * Major mismatch: 0-1 points

- Final URL Score (0-5 points):
  * Valid, relevant URL: 4-5 points
  * Valid but suboptimal: 2-3 points
  * Issues detected: 0-1 points

- Budget Reasonability Score (0-5 points):
  * Budget allows adequate testing: 4-5 points
  * Budget is tight: 2-3 points
  * Budget too low for meaningful data: 0-1 points

=== OUTPUT FORMAT ===
Return ONLY valid JSON with this EXACT structure:

{
  "launchViability": {
    "score": 28,
    "brandSearchVolume": 1500,
    "brandSearchScore": 10,
    "profitMargin": 2.5,
    "profitScore": 8,
    "competitionLevel": "MEDIUM",
    "competitionScore": 5,
    "issues": ["Issue 1", "Issue 2"],
    "suggestions": ["Suggestion 1"]
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
    "suggestions": ["Add more unique headlines"]
  },
  "keywordStrategy": {
    "score": 16,
    "relevanceScore": 7,
    "matchTypeScore": 5,
    "negativeKeywordsScore": 4,
    "totalKeywords": 50,
    "negativeKeywordsCount": 15,
    "matchTypeDistribution": {"EXACT": 20, "PHRASE": 15, "BROAD": 15},
    "issues": ["Need more negative keywords"],
    "suggestions": ["Add negative keywords for free, download, repair"]
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
    "issues": ["Budget may be low for competitive keywords"],
    "suggestions": ["Consider increasing daily budget to $20"]
  },
  "overallRecommendations": [
    "Most critical action item 1",
    "Important improvement 2",
    "Nice to have 3"
  ]
}

CRITICAL RULES:
1. Use EXACT field names as shown above
2. All scores must be within their dimension limits
3. Total score = launchViability.score + adQuality.score + keywordStrategy.score + basicConfig.score
4. Return ONLY the JSON object, no additional text',
  'English',
  1,
  'Launch Score v4.0: 重构为4维度评分体系 - 投放可行性(35分)/广告质量(30分)/关键词策略(20分)/基础配置(15分)',
  datetime('now')
);

-- ============================================================
-- VERIFICATION
-- ============================================================
-- Run these queries to verify migration success:
-- SELECT prompt_id, version, is_active FROM prompt_versions WHERE prompt_id IN ('product_analysis_single', 'brand_analysis_store', 'review_analysis', 'competitor_analysis', 'keywords_generation', 'store_highlights_synthesis', 'launch_score') ORDER BY prompt_id, version DESC;
