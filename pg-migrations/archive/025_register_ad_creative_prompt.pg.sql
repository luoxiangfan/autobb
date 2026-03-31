-- Migration: 025_register_ad_creative_prompt (PostgreSQL version)
-- Description: 注册广告创意生成Prompt并创建v2.0版本（包含增强字段）
-- Created: 2025-12-01

-- 1. 插入 v1.0 版本（原始版本 - 不包含增强字段）
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
  'v1.0',
  'Ad Creative',
  '广告创意生成',
  '基于产品信息、关键词、评论分析等数据，生成Google Ads创意文案（标题和描述）',
  'src/lib/ad-creative-generator.ts',
  'buildAdCreativePrompt',
  'Google Ads广告创意生成系统

基于以下产品信息和数据，生成高质量的Google Ads创意文案：

产品信息:
- 标题: {title}
- 价格: {price}
- 评分: {rating}
- 评论数: {reviews}

关键词:
{keywords}

评论分析:
{review_analysis}

竞品分析:
{competitor_analysis}

请生成:
1. 15个优质广告标题（30字符内）
2. 4个广告描述（90字符内）

要求:
- 突出产品卖点和差异化优势
- 使用高转化关键词
- 符合Google Ads政策
- 语言自然流畅',
  'Chinese',
  false,
  '初始版本：基础产品信息和关键词'
) ON CONFLICT (prompt_id, version) DO NOTHING;

-- 2. 插入 v2.0 版本（包含P0/P1/P2/P3增强字段）
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
  'v2.0',
  'Ad Creative',
  '广告创意生成（增强版）',
  '基于产品信息、增强关键词、深度评论分析、本地化数据、品牌分析等多维数据，生成Google Ads创意文案',
  'src/lib/ad-creative-generator.ts',
  'buildAdCreativePrompt',
  'Google Ads广告创意生成系统（增强版 v2.0）

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

竞品分析:
{competitor_analysis}

质量评分: {quality_score}/100

请生成:
1. 15个优质广告标题（30字符内）
2. 4个广告描述（90字符内）

要求:
- 充分利用增强数据中的产品特性、用户好评、购买理由
- 体现本地化文化要点和品牌定位
- 突出产品卖点和差异化优势
- 使用高转化关键词（优先使用AI增强关键词）
- 符合Google Ads政策
- 语言自然流畅，符合品牌语调',
  'Chinese',
  true,
  '🎯 v2.0重大更新：集成P0/P1/P2/P3增强字段
- P0: enhanced_keywords, enhanced_product_info, enhanced_review_analysis
- P1: enhanced_headlines, enhanced_descriptions（作为参考示例）
- P2: localization_adapt（货币、文化、本地关键词）
- P3: brand_analysis（品牌定位、语调、竞品）
- 数据合并：增强数据与基础数据正确合并并去重
- 质量评分：添加extraction_quality_score展示'
) ON CONFLICT (prompt_id, version) DO NOTHING;

-- 记录迁移历史
INSERT INTO migration_history (migration_name)
VALUES ('025_register_ad_creative_prompt.pg')
ON CONFLICT (migration_name) DO NOTHING;
