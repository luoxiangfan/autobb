-- Migration 142: Update product analysis prompt to v4.17
-- Fix brand description generation logic
--
-- 问题：AI 生成的 brandDescription 包含 "About this item" 产品特性内容
-- 原因：prompt 指导生成 "Detailed description emphasizing technical specs"
-- 修复：明确 productDescription 应该是品牌故事，而非产品特性列表

-- PostgreSQL syntax
-- 1) 取消当前激活版本（确保只保留一个 active）
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'product_analysis_single' AND is_active = TRUE;

-- 2) 幂等写入新版本（若已存在则更新内容）
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
  'v4.17',
  '产品分析',
  '单品产品分析v4.17',
  '修复 productDescription 生成逻辑，确保输出品牌描述而非产品特性列表',
  'src/lib/prompts/product-analysis-single-v4.17.txt',
  'analyzeProductPage',
  -- prompt_content
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
  "productDescription": "Brand story and positioning description (2-3 sentences). Describe the BRAND's value proposition, market position, and what makes it trustworthy. DO NOT copy product features list. Example: 'SIHOO is a leading ergonomic furniture brand trusted by millions of remote workers worldwide. Known for innovative designs that prioritize user comfort and health, SIHOO combines professional-grade quality with accessible pricing.'",
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

=== 🔥 CRITICAL FIELD CLARIFICATIONS (v4.17 Fix) ===

**productDescription** (Brand Description):
✅ CORRECT Example:
"SIHOO is a leading ergonomic furniture brand trusted by millions of remote workers worldwide. Known for innovative designs that prioritize user comfort and health, SIHOO combines professional-grade quality with accessible pricing."

❌ WRONG Example (DO NOT copy product features):
"About this item【Adjusts to You, From Bottom to Top】Whether you're working, gaming, or just relaxing, SIHOO ergonomic chair adapts to your needs..."

**productHighlights** (Product Features):
✅ This is where product features go:
["3D Adjustable Armrests", "Two-way Adjustable Lumbar Support", "Reinforced aluminum base supporting 330 LBS"]

=== IMPORTANT NOTES ===
- 🔥 productDescription = BRAND story (who the brand is, why trust them)
- 🔥 productHighlights = PRODUCT features ("About this item" content goes here)
- 🔥 Leverage User Reviews, FAQs, and Social Proof data for deeper insights
- 🔥 Prioritize customer-validated features over marketing claims
$PROMPT$,
  'English',
  true,
  'v4.17 修复内容:
1. 🔥 修复 productDescription 字段说明：从 "Detailed description emphasizing technical specs and reviews" 改为明确的品牌故事描述
2. 🔥 添加明确的正确示例和错误示例，防止 AI 输出 "About this item" 的原文内容
3. 🔥 强调：productDescription 应该是品牌层面的描述，productHighlights 才是产品特性
4. 🔥 新增 "CRITICAL FIELD CLARIFICATIONS" 章节，清晰区分两个字段的用途
5. ✅ 保持其他字段不变

影响范围：
- 受影响表：prompt_versions
- 影响的offer字段：brand_description (通过 AI 分析生成)
- 已知问题：39个offers的brand_description包含"About this item"内容（可通过重新分析修复）'
)
ON CONFLICT (prompt_id, version) DO UPDATE SET
  category = EXCLUDED.category,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  file_path = EXCLUDED.file_path,
  function_name = EXCLUDED.function_name,
  prompt_content = EXCLUDED.prompt_content,
  language = EXCLUDED.language,
  change_notes = EXCLUDED.change_notes,
  is_active = EXCLUDED.is_active;

-- 3) 激活新版本
UPDATE prompt_versions
SET is_active = TRUE
WHERE prompt_id = 'product_analysis_single' AND version = 'v4.17';
