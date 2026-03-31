-- =====================================================
-- Migration: 105_strict_json_format_constraint
-- Description: 修复JSON解析问题 - 强制AI返回对象格式而非数组
-- Date: 2025-12-24
-- Database: SQLite
-- =====================================================

-- 错误: Unexpected non-whitespace character after JSON at position 3518
-- 原因: AI返回数组格式 [{...}] 而非对象格式 {...}
-- 修复: 在prompt中添加更严格的格式约束

-- ========================================
-- ad_creative_generation: v4.17 → v4.17_p1
-- ========================================

-- 0. 幂等性插入新版本
INSERT OR IGNORE INTO prompt_versions (
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
  'ad_creative_generation',
  'v4.17_p1',
  '广告创意生成',
  '广告创意生成v4.17_p1 - JSON格式修复',
  '添加严格的JSON格式约束，防止AI返回数组格式',
  'src/lib/ad-creative-generator.ts',
  'buildAdCreativePrompt',
  '{{language_instruction}}

Generate Google Ads creative for {{brand}} ({{category}}).

{{link_type_section}}

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}
{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}

{{keywords_section}}

## v4.16 关键词分层架构 (CRITICAL)

### 关键词数据说明

{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

{{link_type_instructions}}

**重要：上述关键词已经过分层筛选，只包含以下两类：**

1. 品牌词（共享层）- 所有创意都可以使用
   - 纯品牌词：{{brand}}, {{brand}} official, {{brand}} store
   - 品牌+品类词：{{brand}} camera, {{brand}} security

2. 桶匹配词（独占层）- 只包含与当前桶主题匹配的关键词
   - 当前桶类型：{{bucket_type}}
   - 当前桶主题：{{bucket_intent}}

## v4.10 关键词嵌入规则 (MANDATORY)

### 强制要求：8/15 (53%+) 标题必须包含关键词

**嵌入规则**:

**规则1: 关键词全部来自{{ai_keywords_section}}**
- 优先选择搜索量>1000的高价值关键词
- 品牌词必须出现在至少2个标题中
- 桶匹配词必须出现在至少6个标题中

**规则2: 嵌入方式 (自然融入，非堆砌)**
- 正确: "4K Security Camera Sale"
- 错误: "Camera Camera Security" (堆砌)

**规则3: 标题变体**
- 15个标题必须各不相同（避免重复）
- 每组5个标题使用不同的核心卖点和表达方式

## v4.11 描述嵌入规则 (MANDATORY)

### 强制要求：5/5 (100%) 描述必须包含关键词

**规则1: 品牌词出现**
- 必须在至少3个描述中包含品牌词 {{brand}}

**规则2: 行动号召 (Call-to-Action)**
- 每个描述必须包含明确的CTA
- CTA示例：Shop Now, Buy Today, Order Now, Get Yours, Explore Collection, Discover More

**规则3: 描述结构**
- 长度：90-150字符
- 必须包含：核心卖点 + 品牌词/关键词 + 明确CTA

## v4.15 本地化规则 (CRITICAL)

**本地化规则**:

**规则1: 货币符号**
- US: USD ($)
- UK: GBP ()
- EU: EUR ()

**规则2: 紧急感本地化**
- US/UK: "Limited Time", "Today Only"
- DE: "Nur heute", "Oferta limitada"
- JP: "今だけ", "期間限定"

## v4.16 店铺链接特殊规则

{{store_creative_instructions}}

## OUTPUT (JSON only, no markdown):

{
  "headlines": [
    {"text": "...", "type": "brand|feature|promo|cta|urgency|social_proof|question|emotional", "length": N}
  ],
  "descriptions": [
    {"text": "...", "type": "feature-benefit-cta|problem-solution-proof|offer-urgency-trust|usp-differentiation", "length": N}
  ],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text": "...", "url": "/", "description": "..."}],
  "path1": "...",
  "path2": "...",
  "theme": "..."
}

**CRITICAL REQUIREMENTS - JSON FORMAT (最重要)**:
1. RETURN A SINGLE JSON OBJECT - start with { and end with }
2. DO NOT wrap the response in an array [...]
3. You MUST return ONLY valid JSON - no markdown formatting, no explanations, no German/other language text
4. All headlines and descriptions must be in the target language ({{target_language}})
5. All headlines must be ≤30 characters
6. All descriptions must be ≤90 characters
7. Return exactly 15 headlines and 4-5 descriptions
8. If you cannot generate valid JSON, return an error message starting with "ERROR:".',
  'English',
  1,
  0,
  'v4.17_p1 JSON格式修复:
1. 添加严格的JSON格式约束（最重要要求）
2. 明确禁止返回数组格式 [...]
3. 强调必须返回单一对象 {...}'
);

-- 1. 将当前活跃版本设为非活跃 (SQLite: is_active = 1 表示活跃)
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_creative_generation' AND is_active = 1;

-- 2. 将 v4.17_p1 设为活跃版本
UPDATE prompt_versions
SET is_active = 1
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.17_p1';

-- 验证结果
SELECT id, prompt_id, name, version, is_active
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY version DESC
LIMIT 5;

-- Migration complete!
