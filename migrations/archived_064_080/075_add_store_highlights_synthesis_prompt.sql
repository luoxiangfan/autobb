-- Migration: 添加店铺产品亮点整合prompt (v1.0)
-- Date: 2025-12-13
-- Description: 新增店铺产品亮点整合prompt，用于从热销商品的产品亮点中智能整合提炼出店铺级的核心产品亮点

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
