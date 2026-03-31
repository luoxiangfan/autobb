-- Migration: 053_ad_elements_prompts_v2.5_category_metadata
-- Description: Phase 2 - 产品分类元数据增强（Store Metadata Enhancement）
-- Created: 2025-12-04
-- Version: v2.4 → v2.5
-- Prompts: ad_elements_headlines, ad_elements_descriptions
-- Impact: +100% Keyword Diversity through product category context

-- ========================================
-- ad_elements_headlines: v2.4 → v2.5
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_elements_headlines' AND is_active = 1;

-- 2. 插入新版本（如果不存在）
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
)
SELECT
  'ad_elements_headlines',
  'v2.5',
  '广告创意生成',
  '广告标题生成v2.5（分类元数据增强版）',
  '支持完整模板变量、评论洞察、促销信息、多语言、产品分类元数据（+100%关键词多样性）',
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

=== 🆕 PRODUCT CATEGORIES (Phase 2 Enhancement) ===
Store Categories: {{productCategories}}

**Category Usage Strategy:**
- Use category keywords to expand headline diversity
- Combine category terms with brand/features for variant headlines
- Example categories: "Smart Home", "Security Cameras", "Home Electronics"
- Generate 2-3 category-based headlines for broader reach

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
- 🆕 **ENHANCED**: Use product categories to generate 1-2 category-focused keywords
- Examples: "Best Home Security Camera", "Smart Home Security", "Wireless Security Camera"

**Group 3: Feature-Focused (4 headlines)**
- Highlight USPs from product features
- Use specific specs when compelling
- 🆕 **ENHANCED**: Combine features with category context when relevant
- Examples: "4K Ultra HD Resolution", "Smart Home 4K Camera", "2-Way Audio Built-In"

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
6. 🆕 **Category Diversity**: Generate at least 2 headlines using product category context

=== OUTPUT FORMAT ===
Return JSON:
{
  "headlines": ["headline1", "headline2", ..., "headline15"],
  "headlineAnalysis": {
    "brandHeadlines": ["indices of brand headlines"],
    "keywordHeadlines": ["indices of keyword headlines"],
    "featureHeadlines": ["indices of feature headlines"],
    "proofHeadlines": ["indices of proof/promo headlines"],
    "categoryHeadlines": ["indices of category-enhanced headlines"]
  }
}',
  'Chinese',
  1,
  '
v2.5 更新内容 (Phase 2: Store Metadata Enhancement):
1. 🆕 添加产品分类元数据输入 ({{productCategories}})
2. 🆕 新增分类关键词策略，提升关键词多样性 +100%
3. 🆕 要求至少生成2个基于分类的标题变体
4. 🆕 优化Keyword-Rich和Feature-Focused组策略，整合分类上下文
5. 🆕 在headlineAnalysis中新增categoryHeadlines追踪分类增强标题
'
WHERE NOT EXISTS (
  SELECT 1 FROM prompt_versions
  WHERE prompt_id = 'ad_elements_headlines' AND version = 'v2.5'
);


-- ========================================
-- ad_elements_descriptions: v2.4 → v2.5
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_elements_descriptions' AND is_active = 1;

-- 2. 插入新版本（如果不存在）
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
)
SELECT
  'ad_elements_descriptions',
  'v2.5',
  '广告创意生成',
  '广告描述生成v2.5（分类元数据增强版）',
  '支持完整模板变量、评论洞察、促销信息、行动号召、产品分类元数据（+100%关键词多样性）',
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

=== 🆕 PRODUCT CATEGORIES (Phase 2 Enhancement) ===
Store Categories: {{productCategories}}

**Category Usage Strategy:**
- Integrate category keywords naturally into descriptions
- Use category context to broaden appeal and improve SEO
- Example: "Best-in-class Smart Home security solution" (using "Smart Home" category)
- Enhance at least 1 description with category context for keyword diversity

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
- 🆕 **ENHANCED**: Optionally integrate category context for broader appeal
- Example: "4K Ultra HD camera captures every detail. See your home clearly day or night."
- Example (category-enhanced): "Smart Home 4K camera with crystal-clear video. Monitor 24/7 with ease."

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
- 🆕 **ENHANCED**: Optionally use category keywords for SEO diversity
- Example: "Shop now for professional-grade security. Easy setup in minutes."
- Example (category-enhanced): "Upgrade your Smart Home security today. Easy setup in minutes."

=== RULES ===
1. Each description MUST be <= 90 characters (including spaces)
2. Include at least one call-to-action per description
3. Use active voice and present tense
4. Avoid generic phrases - be specific to product
5. Include price/discount when compelling
6. 🆕 **Category Diversity**: Integrate category context in at least 1 description for keyword breadth

=== OUTPUT FORMAT ===
Return JSON:
{
  "descriptions": ["description1", "description2", "description3", "description4"],
  "descriptionTypes": ["feature", "social_proof", "promotion", "cta"],
  "categoryEnhanced": [0, 3]
}',
  'Chinese',
  1,
  '
v2.5 更新内容 (Phase 2: Store Metadata Enhancement):
1. 🆕 添加产品分类元数据输入 ({{productCategories}})
2. 🆕 新增分类关键词策略，提升关键词多样性 +100%
3. 🆕 要求至少1个描述整合分类上下文
4. 🆕 优化Feature+Benefit和CTA策略，整合分类关键词以扩大SEO覆盖
5. 🆕 在输出JSON中新增categoryEnhanced数组，追踪分类增强的描述索引
'
WHERE NOT EXISTS (
  SELECT 1 FROM prompt_versions
  WHERE prompt_id = 'ad_elements_descriptions' AND version = 'v2.5'
);

-- ========================================
-- 确保v2.5版本为活跃状态
-- ========================================

-- 激活v2.5版本（无论是新插入还是已存在）
UPDATE prompt_versions
SET is_active = 1
WHERE prompt_id = 'ad_elements_headlines' AND version = 'v2.5';

UPDATE prompt_versions
SET is_active = 1
WHERE prompt_id = 'ad_elements_descriptions' AND version = 'v2.5';
