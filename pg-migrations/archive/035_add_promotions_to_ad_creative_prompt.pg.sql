-- Migration: 035_add_promotions_to_ad_creative_prompt (PostgreSQL)
-- Description: 创建v2.1版本，添加promotions促销信息支持
-- Created: 2025-12-03
-- Priority: P1 - HIGH (预期CTR提升5-15%)

-- 插入 v2.1 版本（添加promotions促销信息支持）
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
  'ad_creative_generation',
  'v2.1',
  'Ad Creative',
  '广告创意生成（Promotions促销版）',
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
  TRUE,  -- 激活此版本
  '🔥 v2.1重要更新：添加促销信息支持（P1优先级）
- 新增: promotion_section占位符，包含活跃促销的完整信息
- 新增: 促销创意强制要求和示例
- 预期效果: CTR提升5-15%
- 机制: 紧迫感(+3-5%) + 明确价值(+5-8%) + 行动驱动(+2-3%)
- 回退: 无促销时系统静默处理，不影响创意生成',
  NOW()
) ON CONFLICT (prompt_id, version) DO NOTHING;

-- 将v2.0版本设为非激活状态（保留历史记录）
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'ad_creative_generation'
  AND version = 'v2.0';

-- 验证更新
SELECT
  version,
  name,
  is_active,
  change_notes
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY version DESC;
