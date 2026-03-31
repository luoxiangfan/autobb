-- Migration: 090_update_keyword_intent_clustering_v4.15
-- Description: 更新keyword_intent_clustering prompt到 v4.15，支持4桶聚类
-- Created: 2025-12-22
-- Version: v4.14 → v4.15
-- Prompts: 1 个 (keyword_intent_clustering)
-- Database: SQLite
-- Author: Claude Code

-- ========================================
-- keyword_intent_clustering: v4.14 → v4.15
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'keyword_intent_clustering' AND is_active = 1;

-- 2. 插入新版本
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
  'keyword_intent_clustering',
  'v4.15',
  '关键词管理',
  '关键词意图聚类v4.15',
  '支持4桶聚类：品牌导向、场景导向、功能导向、高购买意图导向',
  'src/lib/offer-keyword-pool.ts',
  'clusterKeywordsByIntent',
  '你是一个专业的Google Ads关键词分析专家。请将以下关键词按用户搜索意图分成4个语义桶。

# 品牌信息
品牌名称：{{brandName}}
产品类别：{{productCategory}}

# 待分类关键词（已排除纯品牌词）
{{keywords}}

# 分桶规则

## 桶A - 品牌导向 (Brand-Oriented)
**用户画像**：知道要买什么品牌，搜索品牌相关内容
**关键词特征**：
- 品牌+产品词：brand camera, brand vacuum, brand headphones
- 型号相关词：brand model xxx, brand pro, brand plus
- 官方渠道词：brand official, brand store, brand website
- 品牌系列词：brand indoor, brand outdoor, brand doorbell

**示例**：
- eufy security camera
- eufy official store
- eufy outdoor camera
- eufy doorbell
- eufycam 2 pro

## 桶B - 场景导向 (Scenario-Oriented)
**用户画像**：知道要解决什么问题，搜索使用场景/应用环境
**关键词特征**：
- 使用场景词：home security, baby monitor, pet watching
- 应用环境词：garage camera, driveway security, backyard monitoring
- 解决方案词：protect home, monitor baby, watch pets
- 注意：不包含具体功能/规格词

**示例**：
- home security system
- baby monitor camera
- pet watching camera
- driveway security
- garage monitoring

## 桶C - 功能导向 (Feature-Oriented)
**用户画像**：关注技术规格、功能特性、产品评价
**关键词特征**：
- 功能特性词：wireless, night vision, 2k resolution, solar powered
- 技术规格词：4k camera, 180 degree view, long battery
- 购买意图词：best, top rated, cheap, affordable
- 比较词：vs, alternative, better than

**示例**：
- wireless security camera
- night vision camera
- 2k resolution camera
- best doorbell camera
- affordable home camera

## 桶D - 高购买意图导向 (High Purchase Intent)
**用户画像**：有明确购买意图，搜索具体产品或优惠信息
**关键词特征**：
- 购买相关词：buy, purchase, deal, sale, discount, coupon, cheap, price
- 交易词：shop, order, online, store, cheapest, best price
- 促销词：clearance, promotion, offer, bundle, package
- 紧迫感词：limited, today, now, urgent

**示例**：
- buy security camera
- security camera deals
- discount camera
- cheapest security camera
- camera sale today
- security camera coupon
- best price security camera
- buy eufy camera online

# 分桶边界说明（重要）

**场景导向 vs 功能导向的区别**：
- 场景导向 = "在哪里用/为什么用"（Where/Why）
- 功能导向 = "要什么功能/什么规格"（What/How）

**高购买意图导向识别**：
- 包含购买动作词：buy, purchase, shop, order
- 包含价格/优惠词：deal, discount, cheap, price, coupon
- 包含紧迫感词：today, now, limited, urgent
- 包含交易平台词：online, store, shop

**混合关键词处理**：
- "buy wireless camera" → 高购买意图导向（buy是购买动作）
- "wireless baby monitor" → 功能导向（wireless是功能特征）
- "home security" → 场景导向（没有功能词和购买词）
- "4k home camera" → 功能导向（4k是技术规格）
- "security camera deals" → 高购买意图导向（deals是优惠词）

# 分桶原则

1. **互斥性**：每个关键词只能分到一个桶，不能重复
2. **完整性**：所有关键词都必须分配，不能遗漏
3. **均衡性**：尽量保持4个桶的关键词数量相对均衡（理想比例 20%-30%每桶）
4. **语义一致**：同一个桶内的关键词应该有相似的搜索意图
5. **高意图优先**：如果关键词同时符合多个桶的特征，高购买意图导向优先

# 输出格式（JSON）

{
  "bucketA": {
    "intent": "品牌导向",
    "intentEn": "Brand-Oriented",
    "description": "用户知道要买什么品牌",
    "keywords": ["keyword1", "keyword2", ...]
  },
  "bucketB": {
    "intent": "场景导向",
    "intentEn": "Scenario-Oriented",
    "description": "用户知道要解决什么问题",
    "keywords": ["keyword1", "keyword2", ...]
  },
  "bucketC": {
    "intent": "功能导向",
    "intentEn": "Feature-Oriented",
    "description": "用户关注技术规格/功能特性",
    "keywords": ["keyword1", "keyword2", ...]
  },
  "bucketD": {
    "intent": "高购买意图导向",
    "intentEn": "High Purchase Intent",
    "description": "用户有明确购买意图，搜索优惠和购买信息",
    "keywords": ["keyword1", "keyword2", ...]
  },
  "statistics": {
    "totalKeywords": 90,
    "bucketACount": 30,
    "bucketBCount": 30,
    "bucketCCount": 20,
    "bucketDCount": 10,
    "balanceScore": 0.95
  }
}

# 注意事项

1. 返回纯JSON，不要markdown代码块
2. 所有原始关键词必须出现在输出中，不能遗漏
3. balanceScore计算方式：1 - (max差异 / 总数)，越接近1越均衡
4. 高购买意图导向关键词可以与品牌词、场景词、功能词重叠，优先归入桶D',
  'Chinese',
  1,
  '
v4.15 更新内容:
1. 新增桶D - 高购买意图导向，支持4桶聚类
2. 更新分桶规则和示例，添加高意图识别逻辑
3. 更新输出格式，包含bucketD和相应的统计数据
4. 整合高意图关键词到聚类流程中，避免单独生成
'
);

-- Migration completed successfully
-- Total prompts updated: 1
-- Next version: v4.16 (待规划)
