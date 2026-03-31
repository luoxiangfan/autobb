-- =====================================================
-- Migration: 066_consolidated_prompt_analysis.pg.sql
-- Description: 合并分析类Prompts（PostgreSQL版）
-- Date: 2025-12-14
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

UPDATE prompt_versions SET is_active = false
WHERE prompt_id = 'product_analysis_single' AND is_active = true;

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, language,
  is_active, change_notes, created_at
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
  true as is_active,
  '🔧 修复：将AI返回字段从technicalHighlights统一为productHighlights' as change_notes,
  NOW() as created_at
FROM prompt_versions
WHERE prompt_id = 'product_analysis_single' AND version = 'v3.1'
ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  name = EXCLUDED.name,
  prompt_content = EXCLUDED.prompt_content,
  change_notes = EXCLUDED.change_notes;

-- ============================================================
-- PART 2: brand_analysis_store v3.2 (字段添加)
-- ============================================================

UPDATE prompt_versions SET is_active = false
WHERE prompt_id = 'brand_analysis_store' AND is_active = true;

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, language,
  is_active, change_notes, created_at
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
  true as is_active,
  '🔧 增强：为热销商品添加productHighlights字段' as change_notes,
  NOW() as created_at
FROM prompt_versions
WHERE prompt_id = 'brand_analysis_store' AND version = 'v3.1'
ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  name = EXCLUDED.name,
  prompt_content = EXCLUDED.prompt_content,
  change_notes = EXCLUDED.change_notes;

-- ============================================================
-- PART 3: review_analysis v3.2 (增强数字提取)
-- ============================================================

UPDATE prompt_versions SET is_active = false WHERE prompt_id = 'review_analysis';

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, language,
  is_active, change_notes, created_at
) VALUES (
  'review_analysis',
  'v3.2',
  '产品分析',
  '评论分析v3.2',
  '评论分析v3.2 - 增强数字提取和竞品提及分析',
  'src/lib/review-analyzer.ts',
  'analyzeReviews',
  $$You are an expert e-commerce review analyst.

=== INPUT DATA ===
Product Name: {{productName}}
Total Reviews: {{totalReviews}}
Target Language: {{langName}}

=== REVIEWS DATA ===
{{reviewTexts}}

=== ANALYSIS REQUIREMENTS ===
1. **Sentiment Distribution** (Quantitative)
2. **Positive Keywords** (Top 10)
3. **Negative Keywords** (Top 10)
4. **Real Use Cases** (5-8 scenarios)
5. **Purchase Reasons** (Top 5)
6. **User Profiles** (3-5 types)
7. **Common Pain Points** (Top 5)
8. **Quantitative Highlights** (NEW - numbers from reviews)
9. **Competitor Mentions** (NEW - brand comparisons)

=== OUTPUT FORMAT ===
Return JSON with all analysis fields including quantitativeHighlights and competitorMentions$$,
  'English',
  true,
  'v3.2: quantitativeHighlights + competitorMentions',
  NOW()
) ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  prompt_content = EXCLUDED.prompt_content,
  change_notes = EXCLUDED.change_notes;

-- ============================================================
-- PART 4: competitor_analysis v3.2 (竞品弱点挖掘)
-- ============================================================

UPDATE prompt_versions SET is_active = false WHERE prompt_id = 'competitor_analysis';

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, language,
  is_active, change_notes, created_at
) VALUES (
  'competitor_analysis',
  'v3.2',
  '产品分析',
  '竞品分析v3.2',
  '竞品分析v3.2 - 新增竞品弱点挖掘',
  'src/lib/competitor-analyzer.ts',
  'analyzeCompetitors',
  $$You are an e-commerce competitive analysis expert.

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
1. **Feature Comparison**
2. **Unique Selling Points (USPs)**
3. **Competitor Advantages**
4. **Competitor Weaknesses** (NEW - for ad differentiation)
5. **Overall Competitiveness** (0-100)

=== OUTPUT FORMAT ===
Return JSON with featureComparison, uniqueSellingPoints, competitorAdvantages, competitorWeaknesses, overallCompetitiveness$$,
  'English',
  true,
  'v3.2: competitorWeaknesses for ad differentiation',
  NOW()
) ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  prompt_content = EXCLUDED.prompt_content,
  change_notes = EXCLUDED.change_notes;

-- ============================================================
-- PART 5: keywords_generation v3.2 (禁止竞品关键词)
-- ============================================================

UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'keywords_generation' AND is_active = true;

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
  change_notes,
  created_at
) VALUES (
  'keywords_generation',
  'v3.2',
  '关键词生成',
  '关键词生成v3.2',
  '修复竞品关键词冲突：禁止生成竞品品牌关键词',
  'src/lib/keyword-generator.ts',
  'generateKeywords',
  'You are a Google Ads keyword expert.

=== INPUT DATA ===
Brand: {{offer.brand}}
Brand Description: {{offer.brand_description}}
Target Country: {{offer.target_country}}
Category: {{offer.category}}

=== PRODUCT DETAILS ===
Product Name: {{productName}}
Product Features: {{productFeatures}}
Selling Points: {{sellingPoints}}

=== TASK ===
Generate 30 high-quality Google Ads keywords.

=== KEYWORD STRATEGY ===
1. **Brand Keywords** (5-7)
2. **Category Keywords** (8-10)
3. **Feature Keywords** (5-7)
4. **Intent Keywords** (5-7)
5. **Long-tail Keywords** (3-5)

=== CRITICAL RESTRICTIONS ===
⚠️ DO NOT generate competitor brand keywords!

=== OUTPUT FORMAT ===
Return JSON with keywords, estimatedBudget, recommendations',
  'English',
  1,
  true,
  '禁止生成竞品品牌关键词，避免与否定关键词冲突',
  NOW()
) ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  name = EXCLUDED.name,
  prompt_content = EXCLUDED.prompt_content,
  change_notes = EXCLUDED.change_notes;

-- ============================================================
-- PART 6: store_highlights_synthesis v1.0
-- ============================================================

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, is_active, created_at
) VALUES (
  'store_highlights_synthesis',
  'v1.0',
  '品牌分析',
  '店铺产品亮点整合v1.0',
  '从热销商品的产品亮点中智能整合提炼出店铺级的核心产品亮点',
  'src/lib/ai.ts',
  'analyzeProductPage',
  'You are a product marketing expert. Analyze the product highlights from {{productCount}} hot-selling products and synthesize them into 5-8 key store-level product highlights.

=== INPUT ===
{{productHighlights}}

=== TASK ===
Synthesize into 5-8 concise, store-level product highlights.

=== OUTPUT FORMAT ===
Return JSON: {"storeHighlights": ["Highlight 1", ...]}

Output in {{langName}}.',
  true,
  NOW()
) ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  name = EXCLUDED.name,
  prompt_content = EXCLUDED.prompt_content;

-- ============================================================
-- PART 7: launch_score v4.0 (4维度投放评分体系)
-- ============================================================
-- 问题修复：077迁移文件遗漏了此prompt的插入
-- 代码 src/lib/scoring.ts 调用 loadPrompt('launch_score')

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
  $$You are a professional Google Ads campaign launch evaluator using the NEW 4-DIMENSION scoring system.

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
4. Return ONLY the JSON object, no additional text$$,
  'English',
  true,
  'Launch Score v4.0: 重构为4维度评分体系 - 投放可行性(35分)/广告质量(30分)/关键词策略(20分)/基础配置(15分)',
  NOW()
) ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  prompt_content = EXCLUDED.prompt_content,
  change_notes = EXCLUDED.change_notes;

-- ============================================================
-- VERIFICATION
-- ============================================================
-- SELECT prompt_id, version, is_active FROM prompt_versions
-- WHERE prompt_id IN ('product_analysis_single', 'brand_analysis_store', 'review_analysis',
--                     'competitor_analysis', 'keywords_generation', 'store_highlights_synthesis',
--                     'launch_score')
-- ORDER BY prompt_id, version DESC;
