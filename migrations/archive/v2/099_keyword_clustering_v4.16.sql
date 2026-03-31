-- =====================================================
-- Migration: 099_keyword_clustering_v4.16.sql
-- Description: 关键词聚类Prompt v4.16 - 支持店铺链接类型区分
-- Date: 2025-12-24
-- Database: SQLite
-- =====================================================

-- ========================================
-- keyword_intent_clustering: v4.15 → v4.16
-- ========================================

-- 0. 检查是否已是 v4.16 活跃版本（防重复执行）
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
  'keyword_intent_clustering',
  'v4.16',
  '关键词聚类',
  '关键词意图聚类v4.16 - 支持店铺链接类型区分',
  '根据链接类型（单品/店铺）使用不同的分桶策略，支持5种店铺创意类型',
  'src/lib/offer-keyword-pool.ts',
  'clusterKeywordsByIntent',
  '你是一个专业的Google Ads关键词分析专家。根据链接类型将关键词按用户搜索意图分成语义桶。

# 链接类型
链接类型：{{linkType}}
{{^linkType}}product{{/linkType}}
- product (单品链接): 目标是让用户购买具体产品
- store (店铺链接): 目标是让用户进入店铺

# 品牌信息
品牌名称：{{brandName}}
产品类别：{{productCategory}}

# 待分类关键词（已排除纯品牌词）
{{keywords}}

{{^linkType}}
# ========================================
# 单品链接分桶策略 (Product Page)
# ========================================
## 桶A - 产品型号导向 (Product-Specific)
**用户画像**：搜索具体产品型号、配置
**关键词特征**：
- 型号词：model xxx, pro, plus, max, ultra
- 产品词：camera, doorbell, vacuum, speaker
- 配置词：2k, 4k, 1080p, wireless, solar

**示例**：
- eufy security camera
- eufy doorbell 2k
- eufycam 2 pro
- eufy solar panel

## 桶B - 购买意图导向 (Purchase-Intent)
**用户画像**：有购买意向，搜索价格/优惠
**关键词特征**：
- 价格词：price, cost, cheap, affordable, deal, discount
- 购买词：buy, purchase, shop, order
- 促销词：sale, clearance, promotion, bundle

**示例**：
- buy security camera
- security camera deal
- eufy camera price
- discount doorbell

## 桶C - 功能特性导向 (Feature-Focused)
**用户画像**：关注技术规格、功能特性
**关键词特征**：
- 功能词：night vision, motion detection, two-way audio
- 规格词：4k, 2k, 1080p, wireless, battery
- 性能词：long battery, solar powered, waterproof

**示例**：
- wireless security camera
- night vision doorbell
- solar powered camera
- 4k security system

## 桶D - 紧迫促销导向 (Urgency-Promo)
**用户画像**：追求即时购买、最佳优惠
**关键词特征**：
- 紧迫感词：limited, today, now, urgent, ends soon
- 限时词：flash sale, today only, limited time
- 库存词：in stock, available, few left

**示例**：
- security camera today
- doorbell camera sale
- limited time offer
- eufy camera in stock

{{/linkType}}
{{#linkType}}
{{#equals linkType "store"}}
# ========================================
# 店铺链接分桶策略 (Store Page)
# ========================================

## 桶A - 品牌信任导向 (Brand-Trust)
**用户画像**：认可品牌，寻求官方购买渠道
**关键词特征**：
- 品牌官方词：brand official, brand store, brand website
- 授权词：authorized, certified, genuine
- 正品保障词：authentic, original, real

**示例**：
- eufy official store
- eufy authorized dealer
- buy eufy authentic
- eufy official website

## 桶B - 场景解决方案导向 (Scene-Solution)
**用户画像**：有具体使用场景需求
**关键词特征**：
- 场景词：home security, baby monitor, pet watching
- 环境词：indoor, outdoor, garage, backyard
- 解决方案词：protect home, monitor baby, watch pets

**示例**：
- home security system
- baby monitor camera
- pet watching camera
- outdoor security

## 桶C - 精选推荐导向 (Collection-Highlight)
**用户画像**：想了解店铺热销/推荐产品
**关键词特征**：
- 热销词：best seller, top rated, popular
- 推荐词：recommended, featured, choice
- 系列词：indoor camera series, outdoor kit

**示例**：
- eufy best seller
- top rated security camera
- eufy outdoor camera kit
- featured products

## 桶D - 信任信号导向 (Trust-Signals)
**用户画像**：关注店铺信誉、售后保障
**关键词特征**：
- 评价词：review, rating, testimonial
- 保障词：warranty, guarantee, replacement
- 服务词：support, service, installation

**示例**：
- eufy camera review
- security camera warranty
- eufy customer support
- installation service

## 桶S - 店铺全景导向 (Store-Overview)
**用户画像**：想全面了解店铺
**关键词特征**：
- 店铺概览词：all products, full range, complete collection
- 分类词：camera, doorbell, sensor, accessory
- 综合词：eufy store, eufy products, eufy catalog

**示例**：
- eufy store
- eufy all products
- eufy security camera
- eufy product catalog
{{/equals}}
{{/linkType}}

# 分桶原则

1. **互斥性**：每个关键词只能分到一个桶
2. **完整性**：所有关键词都必须分配
3. **均衡性**：保持各桶关键词数量相对均衡
4. **高意图优先**：如果关键词符合多个桶，优先归入高意图桶

{{^linkType}}
# 输出格式（单品链接 - 4桶）
{
  "bucketA": { "intent": "产品型号导向", "intentEn": "Product-Specific", "keywords": [...] },
  "bucketB": { "intent": "购买意图导向", "intentEn": "Purchase-Intent", "keywords": [...] },
  "bucketC": { "intent": "功能特性导向", "intentEn": "Feature-Focused", "keywords": [...] },
  "bucketD": { "intent": "紧迫促销导向", "intentEn": "Urgency-Promo", "keywords": [...] },
  "statistics": { "totalKeywords": N, "bucketACount": N, "bucketBCount": N, "bucketCCount": N, "bucketDCount": N, "balanceScore": 0.95 }
}
{{/linkType}}
{{#linkType}}
{{#equals linkType "store"}}
# 输出格式（店铺链接 - 5桶）
{
  "bucketA": { "intent": "品牌信任导向", "intentEn": "Brand-Trust", "keywords": [...] },
  "bucketB": { "intent": "场景解决方案导向", "intentEn": "Scene-Solution", "keywords": [...] },
  "bucketC": { "intent": "精选推荐导向", "intentEn": "Collection-Highlight", "keywords": [...] },
  "bucketD": { "intent": "信任信号导向", "intentEn": "Trust-Signals", "keywords": [...] },
  "bucketS": { "intent": "店铺全景导向", "intentEn": "Store-Overview", "keywords": [...] },
  "statistics": { "totalKeywords": N, "bucketACount": N, "bucketBCount": N, "bucketCCount": N, "bucketDCount": N, "bucketSCount": N, "balanceScore": 0.95 }
}
{{/equals}}
{{/linkType}}

注意事项：
1. 返回纯JSON，不要markdown代码块
2. 所有原始关键词必须出现在输出中
3. balanceScore = 1 - (max差异 / 总数)',
  'Chinese',
  1,
  0,
  'v4.16 更新内容:
1. 支持链接类型参数 (linkType: product/store)
2. 单品链接: 4桶策略 (A产品/B购买/C功能/D紧迫)
3. 店铺链接: 5桶策略 (A品牌/B场景/C精选/D信任/S全景)
4. 优化各桶的关键词特征和示例'
);

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'keyword_intent_clustering' AND is_active = 1;

-- 2. 将 v4.16 设为活跃版本
UPDATE prompt_versions
SET is_active = 1
WHERE prompt_id = 'keyword_intent_clustering' AND version = 'v4.16';

-- 验证结果
SELECT id, prompt_id, name, version, is_active
FROM prompt_versions
WHERE prompt_id = 'keyword_intent_clustering'
ORDER BY version DESC
LIMIT 3;
