-- Migration: 036_register_competitor_keyword_inference_prompt
-- Description: 注册竞品关键词推断Prompt（修复缺失的prompt版本）
-- Created: 2025-12-03
-- Issue: "AI推断竞品失败: 找不到激活的Prompt版本: competitor_keyword_inference"

-- 插入 competitor_keyword_inference v1.0 版本
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
  'v1.0',
  '竞品分析',
  '竞品搜索关键词推断',
  '基于产品信息推断Amazon竞品搜索关键词，用于AI驱动的竞品发现',
  'src/lib/competitor-analyzer.ts',
  'inferCompetitorKeywords',
  'You are an expert e-commerce analyst specializing in competitive analysis on Amazon.

Given the following product information, generate search terms that will help find similar competing products on Amazon.

**Product Information:**
- Product Name: {{productInfo.name}}
- Brand: {{productInfo.brand}}
- Category: {{productInfo.category}}
- Price Range: {{productInfo.price}}
- Target Market: {{productInfo.targetCountry}}

**Your Task:**
Generate 3-5 search terms that would find similar competing products on Amazon. These search terms should:

1. **Be specific to the product category** - Use the exact product type (e.g., "robot vacuum", "wireless earbuds")
2. **Include key features** - If the product has notable features, include relevant feature keywords
3. **Consider the target market** - Use language appropriate for the target country''s Amazon marketplace
4. **Avoid brand names** - Focus on generic product terms to find competitors
5. **Be search-optimized** - Use terms that Amazon customers would actually search for

**Output Format:**
Return a JSON object with the following structure:
```json
{
  "searchTerms": [
    "search term 1",
    "search term 2",
    "search term 3"
  ],
  "reasoning": "Brief explanation of why these terms were chosen"
}
```

**Important:**
- Each search term should be 2-5 words
- Focus on product type and key differentiating features
- Consider local language if target country is not English-speaking
- Prioritize terms that will return actual competing products, not accessories or unrelated items',
  'English',
  1,
  '初始版本：基于产品信息推断竞品搜索关键词，支持多语言市场'
);

-- 验证插入
SELECT
  prompt_id,
  version,
  name,
  is_active,
  created_at
FROM prompt_versions
WHERE prompt_id = 'competitor_keyword_inference';
