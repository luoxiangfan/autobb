-- =====================================================
-- Migration: 100_keyword_clustering_v4.17.pg.sql
-- Description: 关键词聚类Prompt v4.17 - 修复店铺链接聚类不均衡问题
-- Date: 2025-12-24
-- Database: PostgreSQL
-- =====================================================

-- ============================================================
-- keyword_intent_clustering: v4.16 → v4.17
-- ============================================================

-- Step 1: 检查是否已是 v4.17 活跃版本（防重复执行）
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM prompt_versions
        WHERE prompt_id = 'keyword_intent_clustering'
          AND version = 'v4.17'
          AND is_active = TRUE
    ) THEN
        RAISE NOTICE 'v4.17 已是活跃版本，跳过迁移';
    ELSE
        -- Step 2: 将当前活跃版本设为非活跃
        UPDATE prompt_versions
        SET is_active = FALSE
        WHERE prompt_id = 'keyword_intent_clustering' AND is_active = TRUE;

        -- Step 3: 插入新版本 v4.17
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
          change_notes
        ) VALUES (
          'keyword_intent_clustering',
          'v4.17',
          '关键词聚类',
          '关键词意图聚类v4.17 - 修复店铺链接聚类不均衡',
          '修复v4.16店铺链接聚类不均衡问题，明确各桶边界，添加强制均衡分配规则',
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
# 店铺链接分桶策略 (Store Page) - v4.17 修复版
# ========================================

## 🔥 v4.17 核心原则：均衡分配

**重要**：确保5个桶都有合理分布！如果某些桶没有完美匹配的关键词，请按以下规则分配：

### 桶A - 品牌信任导向 (Brand-Trust)
**用户画像**：认可品牌，寻求官方购买渠道
**关键词特征**：
- 官方词：official, store, website, shop
- 授权词：authorized, certified, genuine
- 正品保障：authentic, original, real
- 购买导向：buy, purchase, get

**示例**：
- roborock official store
- roborock buy
- eufy authorized dealer
- buy eufy authentic

### 桶B - 场景解决方案导向 (Scene-Solution)
**用户画像**：有具体使用场景需求
**关键词特征**：
- 场景词：home, house, floor, carpet, pet, baby, kitchen
- 环境词：indoor, outdoor, garage, backyard, living room
- 任务词：clean, mop, vacuum, sweep, wash

**示例**：
- home cleaning robot
- pet hair vacuum
- floor cleaning mop
- indoor robot vacuum

### 桶C - 精选推荐导向 (Collection-Highlight)
**用户画像**：想了解店铺热销/推荐产品
**关键词特征**：
- 热销词：best, top, popular, seller, rating
- 推荐词：recommended, featured, choice, new
- 高端词：pro, ultra, max, premium

**示例**：
- roborock best seller
- top rated robot vacuum
- roborock ultra
- new robot vacuum

### 桶D - 信任信号导向 (Trust-Signals)
**用户画像**：关注店铺信誉、售后保障
**关键词特征**：
- 评价词：review, rating, testimonial, feedback
- 保障词：warranty, guarantee, replacement, return
- 服务词：support, service, installation, help

**示例**：
- roborock review
- robot vacuum warranty
- vacuum cleaner support

### 桶S - 店铺全景导向 (Store-Overview)
**用户画像**：想全面了解店铺
**关键词特征**：
- 店铺概览：all products, full range, complete, entire
- 产品类别：vacuum, mop, robot, cleaner
- 品牌+产品：brand + product type（不含特定型号）

**示例**：
- roborock vacuum
- robot mop
- roborock robot cleaner
- roborock all products

{{/equals}}
{{/linkType}}
{{/linkType}}

# 分桶原则

1. **互斥性**：每个关键词只能分到一个桶
2. **完整性**：所有关键词都必须分配
3. **🔥 均衡性（v4.17核心）**：
   - 确保5个桶都有关键词分布
   - 如果某个桶没有完美匹配，扩展关键词特征定义
   - 目标是每个桶至少有 15-25% 的关键词
   - 宁可让关键词"勉强"符合某个桶，也不要让某个桶为空
4. **高意图优先**：如果关键词符合多个桶，优先归入高意图桶

# 输出格式（店铺链接 - 5桶）
{
  "bucketA": { "intent": "品牌信任导向", "intentEn": "Brand-Trust", "keywords": [...] },
  "bucketB": { "intent": "场景解决方案导向", "intentEn": "Scene-Solution", "keywords": [...] },
  "bucketC": { "intent": "精选推荐导向", "intentEn": "Collection-Highlight", "keywords": [...] },
  "bucketD": { "intent": "信任信号导向", "intentEn": "Trust-Signals", "keywords": [...] },
  "bucketS": { "intent": "店铺全景导向", "intentEn": "Store-Overview", "keywords": [...] },
  "statistics": { "totalKeywords": N, "bucketACount": N, "bucketBCount": N, "bucketCCount": N, "bucketDCount": N, "bucketSCount": N, "balanceScore": 0.95 }
}

注意事项：
1. 返回纯JSON，不要markdown代码块
2. 所有原始关键词必须出现在输出中
3. balanceScore = 1 - (max差异 / 总数)
4. 🔥 确保没有桶为空！即使关键词不完全符合某个桶的定义，也要分配一些',
          'Chinese',
          1,
          TRUE,
          'v4.17 更新内容:
1. 修复v4.16聚类不均衡问题（A/B/D桶常为空）
2. 明确各桶的关键词特征，避免模糊边界
3. 添加"强制均衡分配"规则
4. 扩展产品型号词的匹配规则（如 ultra→C桶精选推荐）
5. 确保即使关键词不完美匹配，每个桶也要有数据'
        )
        ON CONFLICT (prompt_id, version) DO NOTHING;

        RAISE NOTICE 'v4.17 迁移完成';
    END IF;
END $$;

-- 验证结果
SELECT id, prompt_id, name, version, is_active
FROM prompt_versions
WHERE prompt_id = 'keyword_intent_clustering'
ORDER BY version DESC
LIMIT 3;
