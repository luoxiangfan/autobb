-- Migration 071: Rename bucket classifications for clearer semantics
--
-- Purpose: 重命名桶分类以提供更清晰的语义
--   - 桶A: 产品导向(Product-Oriented) → 品牌导向(Brand-Oriented)
--   - 桶C: 需求导向(Demand-Oriented) → 功能导向(Feature-Oriented)
--
-- Rationale:
--   - "品牌导向"更准确描述包含品牌名的关键词搜索意图
--   - "功能导向"与"场景导向"边界更清晰（功能=技术规格，场景=使用环境）
--
-- Changes:
-- 1. 更新 offer_keyword_pools 表中现有数据
-- 2. 更新 prompt_versions 中的 keyword_intent_clustering prompt
-- 3. 更新 ad_creative_generation prompt
-- 4. 更新 ad_creatives 表中的 bucket_intent 字段

-- ============================================================
-- PART 1: 更新 offer_keyword_pools 表中现有数据
-- ============================================================

UPDATE offer_keyword_pools
SET bucket_a_intent = '品牌导向'
WHERE bucket_a_intent = '产品导向';

UPDATE offer_keyword_pools
SET bucket_c_intent = '功能导向'
WHERE bucket_c_intent = '需求导向';

-- ============================================================
-- PART 2: 更新 keyword_intent_clustering prompt v1.1
-- ============================================================

-- 停用旧版本
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'keyword_intent_clustering' AND is_active = 1;

-- 插入新版本 v1.1
INSERT INTO prompt_versions (
  prompt_id,
  name,
  version,
  category,
  description,
  file_path,
  function_name,
  prompt_content,
  change_notes,
  is_active
) VALUES (
  'keyword_intent_clustering',
  '关键词意图聚类v1.1',
  'v1.1',
  '关键词管理',
  '将非品牌关键词按用户搜索意图分成3个语义桶：品牌导向、场景导向、功能导向',
  'src/lib/offer-keyword-pool.ts',
  'clusterKeywordsByIntent',
  '你是一个专业的Google Ads关键词分析专家。请将以下关键词按用户搜索意图分成3个语义桶。

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

# 分桶边界说明（重要）

**场景导向 vs 功能导向的区别**：
- 场景导向 = "在哪里用/为什么用"（Where/Why）
- 功能导向 = "要什么功能/什么规格"（What/How）

**混合关键词处理**：
- "wireless baby monitor" → 功能导向（wireless是功能特征）
- "home security" → 场景导向（没有功能词）
- "4k home camera" → 功能导向（4k是技术规格）

# 分桶原则

1. **互斥性**：每个关键词只能分到一个桶，不能重复
2. **完整性**：所有关键词都必须分配，不能遗漏
3. **均衡性**：尽量保持3个桶的关键词数量相对均衡（理想比例 30%-40%每桶）
4. **语义一致**：同一个桶内的关键词应该有相似的搜索意图

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
  "statistics": {
    "totalKeywords": 90,
    "bucketACount": 30,
    "bucketBCount": 30,
    "bucketCCount": 30,
    "balanceScore": 0.95
  }
}

# 注意事项

1. 返回纯JSON，不要markdown代码块
2. 所有原始关键词必须出现在输出中，不能遗漏
3. balanceScore计算方式：1 - (max差异 / 总数)，越接近1越均衡',
  'v1.1 重命名分类：产品导向→品牌导向，需求导向→功能导向，明确场景vs功能的边界',
  1
);

-- ============================================================
-- PART 3: 更新 ad_creative_generation prompt v4.11
-- ============================================================

-- 停用旧版本
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_creative_generation' AND is_active = 1;

INSERT INTO prompt_versions (
  prompt_id,
  name,
  version,
  category,
  description,
  file_path,
  function_name,
  prompt_content,
  change_notes,
  is_active
)
SELECT
  'ad_creative_generation',
  '广告创意生成v4.11 - 分类重命名版',
  'v4.11',
  category,
  '重命名桶分类：产品导向→品牌导向，需求导向→功能导向',
  file_path,
  function_name,
  REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(
            REPLACE(prompt_content,
              '桶A（产品导向）文案风格',
              '桶A（品牌导向）文案风格'
            ),
            'Headlines: 突出产品线丰富、型号多样、品类齐全',
            'Headlines: 突出品牌实力、官方正品、品牌优势'
          ),
          'Descriptions: 介绍产品系列、规格参数、产品优势',
          'Descriptions: 强调品牌价值、官方保障、品牌故事'
        ),
        '"Eufy Indoor & Outdoor Cams | Full Product Line"',
        '"Official Eufy Store | Trusted Brand Quality"'
      ),
      '桶C（需求导向）文案风格',
      '桶C（功能导向）文案风格'
    ),
    'Demand-Oriented',
    'Feature-Oriented'
  ),
  'v4.11 重命名：产品导向→品牌导向，需求导向→功能导向',
  1
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.10';

-- ============================================================
-- PART 4: 更新 ad_creatives 表中的 bucket_intent 字段
-- ============================================================

UPDATE ad_creatives
SET bucket_intent = '品牌导向'
WHERE bucket_intent = '产品导向';

UPDATE ad_creatives
SET bucket_intent = '功能导向'
WHERE bucket_intent = '需求导向';
